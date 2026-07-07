import { writeFileSync } from 'node:fs';
import path from 'node:path';
import * as core from '@actions/core';
import { context } from './context.mjs';
import { discoverPackages } from './discoverPackages.mjs';
import { pack } from './pack.mjs';
import { packedSize } from './metrics/packedSize.mjs';
import { bundleSize } from './metrics/bundleSize.mjs';
import { installSize } from './metrics/installSize.mjs';
import { postComment } from './comment.mjs';

// Fixed name/location for the JSON artifact — deliberately not configurable.
// This action runs across many repos, and a future job scraping every run's
// artifact to feed a time-series store needs one predictable path per repo,
// not a per-caller-configured one it would have to discover first.
const OUTPUT_FILENAME = 'package-metrics-result.json';

// First statement: fork-PR guard. Checked before any other input is read, and
// before discoverPackages/pack ever run — a fork-triggered `pull_request` run
// could never post a comment anyway (GitHub already downgrades its token to
// read-only/no-secrets for those runs), so there's no point burning CI
// minutes on the full pack/bundle/install analysis.
if (
  context.eventName === 'pull_request' &&
  context.payload.pull_request.head.repo?.full_name !== context.payload.repository.full_name
) {
  // A null head.repo (source repo deleted after the PR was opened) is still
  // treated as "not the same repo" — err on the side of skipping rather than
  // throwing on the missing `.full_name`.
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

  // Pack every discovered package up front (exactly once each) so every
  // sibling's tgzPath is available before any installSize call needs it.
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

  // Only safe to clean up now: any package's installSize() may have read
  // ANY OTHER package's tgz (via the file: rewrite for workspace:* sibling
  // deps), so no packResult's temp dir can be removed until every package's
  // buildPackageRecord (and therefore every installSize call in this run)
  // has settled — not just the owning package's own.
  await Promise.all(packResults.map((r) => r.cleanup()));

  const result = {
    schemaVersion: 1,
    // On `pull_request` events, context.sha is the ephemeral merge commit
    // GitHub synthesizes for the run, not the actual PR head commit — using
    // it would attribute the report to a commit that doesn't correspond to
    // anything in the PR's own history. Prefer the real head sha when present.
    commit: context.payload.pull_request?.head?.sha ?? context.sha,
    timestamp: new Date().toISOString(),
    packages: packageRecords,
  };

  const outputPath = path.join(workspaceRoot, OUTPUT_FILENAME);
  writeFileSync(outputPath, JSON.stringify(result, null, 2));

  core.setOutput('json-path', outputPath);
  core.setOutput('json', JSON.stringify(result));

  // Comment posting is only applicable on `pull_request` runs (there's no
  // issue/PR to comment on for a `push` run) and only when the caller opted
  // in — every other combination is a silent no-op, not a warning or error.
  // postComment() itself never throws (see comment.mjs), so no try/catch is
  // needed here — a failure there degrades to a core.warning, well after the
  // JSON artifact above has already been written and the outputs already set.
  if (enableComment && context.eventName === 'pull_request') {
    await postComment(result, githubToken);
  }
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
    // Packing failed for this package, so there's nothing to install — surface
    // the same upstream pack error against installSize too, rather than
    // silently reporting it only against packedSize.
    installSizeResult = { installSize: null, error: packError };
  }
  if (installSizeResult.error) {
    errors.installSize = installSizeResult.error;
  }

  // Deliberately no cleanup() call here: this tgz (and every sibling's tgz)
  // must stay on disk until ALL packages' buildPackageRecord calls in this
  // run have finished, since any other package's installSize() may still be
  // mid-install reading this tgz via a file: sibling rewrite. See the
  // Promise.all(packResults.map(cleanup)) in run() for where cleanup
  // actually happens.
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
