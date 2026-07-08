import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import * as exec from '@actions/exec';
import { context } from './context.mjs';
import { discoverPackages } from './discoverPackages.mjs';
import { pack } from './pack.mjs';
import { packedSize } from './metrics/packedSize.mjs';
import { bundleSize } from './metrics/bundleSize.mjs';
import { installSize } from './metrics/installSize.mjs';
import { buildCommentBody, postComment } from './comment.mjs';

// Fixed, not configurable — lets a future job scrape this across many repos
// without discovering a per-repo path.
const OUTPUT_FILENAME = 'package-metrics-result.json';

// Fork PRs get a read-only token from GitHub anyway (can't comment), so skip
// the whole run rather than burn CI minutes on it.
if (
  context.eventName === 'pull_request' &&
  context.payload.pull_request.head.repo?.full_name !== context.payload.repository.full_name
) {
  core.notice('package-metrics: skipping — PR is from a fork');
} else {
  await run();
}

async function run() {
  const paths = core.getInput('paths');
  const isMonorepo = core.getBooleanInput('is-monorepo');
  const enableComment = core.getBooleanInput('enable-comment');
  const githubToken = core.getInput('github-token');

  const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();

  let packages;
  try {
    packages = discoverPackages({ workspaceRoot, isMonorepo, paths });
  } catch (err) {
    core.setFailed(err.message);
    return;
  }

  // Pack everything up front so sibling tgzPaths are ready before any
  // installSize call needs them.
  const packResults = await Promise.all(packages.map((pkg) => pack(pkg.path, workspaceRoot)));

  const siblingTgzPaths = {};
  for (let i = 0; i < packages.length; i++) {
    if (packResults[i].tgzPath) {
      siblingTgzPaths[packages[i].name] = packResults[i].tgzPath;
    }
  }

  const packageRecords = await Promise.all(
    packages.map((pkg, i) => buildPackageRecord(pkg, packResults[i], siblingTgzPaths)),
  );

  // Can't clean up until every installSize call has settled, since any
  // package's installSize may have read another package's tgz.
  await Promise.all(packResults.map((r) => r.cleanup()));

  // context.sha is the merge commit on pull_request events, not the PR's
  // actual head commit.
  const commit = context.payload.pull_request?.head?.sha ?? context.sha;
  const analyzedCommit = await getAnalyzedCommit(workspaceRoot);
  if (analyzedCommit && analyzedCommit !== commit) {
    core.warning(
      `package-metrics: checked-out commit (${analyzedCommit}) doesn't match the reported commit (${commit}) ` +
        '— pin the checkout step\'s ref to ${{ github.event.pull_request.head.sha }} to fix this.',
    );
  }

  const result = {
    schemaVersion: 1,
    commit,
    analyzedCommit,
    runId: context.runId,
    runUrl: `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}`,
    timestamp: new Date().toISOString(),
    packages: packageRecords,
  };

  const outputPath = path.join(workspaceRoot, OUTPUT_FILENAME);
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  core.setOutput('json-path', outputPath);
  core.setOutput('json', JSON.stringify(result));

  // Independent of enable-comment/PR context — always visible on the run's
  // own summary page, not just as a PR comment.
  try {
    await core.summary.addRaw(buildCommentBody(result)).write();
  } catch (err) {
    core.warning(`package-metrics: failed to write job summary — ${err.message}`);
  }

  if (enableComment && context.eventName === 'pull_request') {
    await postComment(result, githubToken);
  }
}

// The actual git HEAD of the workspace when analysis ran — independent of
// what `commit` claims, so drift (e.g. an unpinned checkout ref) is visible
// in the data itself, not just a CI log. Never throws.
async function getAnalyzedCommit(workspaceRoot) {
  const { exitCode, stdout } = await exec.getExecOutput('git', ['rev-parse', 'HEAD'], {
    cwd: workspaceRoot,
    ignoreReturnCode: true,
    silent: true,
  });
  return exitCode === 0 ? stdout.trim() : null;
}

async function buildPackageRecord(pkg, packResult, allSiblingTgzPaths) {
  const errors = {};

  const { packedSize: packed, unpackedSize, error: packError } = packedSize(packResult);
  if (packError) {
    errors.packedSize = packError;
  }

  let installSizeResult;
  if (packResult.tgzPath) {
    // Exclude this package's own tgz from its sibling map.
    const { [pkg.name]: _own, ...siblingTgzPaths } = allSiblingTgzPaths;
    installSizeResult = await installSize(packResult.tgzPath, siblingTgzPaths);
  } else {
    // No tgz means packing failed — surface that error for installSize too.
    installSizeResult = { installSize: null, error: packError };
  }
  if (installSizeResult.error) {
    errors.installSize = installSizeResult.error;
  }

  // No cleanup() here — tgzs must stay on disk until every package's
  // installSize has run; see the Promise.all(cleanup) in run().
  const bundleSizeResult = await bundleSize(pkg.path);
  if (bundleSizeResult.error) {
    errors.bundleSize = bundleSizeResult.error;
  }

  return {
    name: pkg.name,
    version: pkg.version,
    path: pkg.path,
    metrics: {
      packedSize: packed,
      unpackedSize,
      bundleSize: bundleSizeResult.bundleSize,
      bundleSizeGzip: bundleSizeResult.bundleSizeGzip,
      installSize: installSizeResult.installSize,
    },
    errors,
  };
}
