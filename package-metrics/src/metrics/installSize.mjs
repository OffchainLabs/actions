import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';
import { sumDirSize } from '../fsSize.mjs';

// Measures the on-disk node_modules footprint of installing an already-packed
// tarball. Any dependency matching a key in siblingTgzPaths gets rewritten to
// a file: reference to that sibling's own (recursively resolved) package
// directory, so a workspace:* dependency pnpm/yarn rewrote to a
// real-but-unpublished version doesn't 404 against the registry — including
// transitively, for chains like c -> b -> a where none of the 3 are published.
// Never throws.
export async function installSize(tgzPath, siblingTgzPaths = {}) {
  let extractDir;
  let scratchDir;
  const siblingDirs = [];
  try {
    extractDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-extract-'));
    const packageDir = await extractAndRewrite(tgzPath, extractDir, siblingTgzPaths, new Set(), siblingDirs);

    scratchDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-scratch-'));
    await writeFile(
      path.join(scratchDir, 'package.json'),
      JSON.stringify({ name: 'scratch', version: '0.0.0', private: true }),
    );

    // --install-links is required: npm otherwise symlinks a folder target
    // outside the project root instead of installing its dependencies. It
    // applies to every file: dependency in the tree, not just the top-level
    // one, so nested sibling folders get installed as real copies too.
    const { exitCode, stdout, stderr } = await exec.getExecOutput(
      'npm',
      [
        'install',
        packageDir,
        '--install-links',
        '--omit=dev',
        '--ignore-scripts',
        '--no-save',
        '--no-audit',
        '--no-fund',
      ],
      { cwd: scratchDir, ignoreReturnCode: true },
    );
    if (exitCode !== 0) {
      throw new Error(`package-metrics: npm install failed (exit ${exitCode}): ${(stderr || stdout).trim()}`);
    }

    const size = sumDirSize(path.join(scratchDir, 'node_modules'));
    return { installSize: size, error: null };
  } catch (err) {
    return { installSize: null, error: err.message };
  } finally {
    if (extractDir) {
      await rm(extractDir, { recursive: true, force: true }).catch(() => {});
    }
    if (scratchDir) {
      await rm(scratchDir, { recursive: true, force: true }).catch(() => {});
    }
    await Promise.all(siblingDirs.map((dir) => rm(dir, { recursive: true, force: true }).catch(() => {})));
  }
}

// Extracts a tgz into extractDir and rewrites its own workspace-sibling
// dependency/optionalDependency/peerDependency entries to file: references —
// recursively resolving each sibling's tgz the same way first, so a
// dependency chain of any depth resolves entirely locally. `visiting` guards
// against a circular workspace dependency recursing forever.
async function extractAndRewrite(tgzPath, extractDir, siblingTgzPaths, visiting, siblingDirs) {
  await exec.exec('tar', ['-xf', tgzPath, '-C', extractDir]);

  // npm/pnpm/yarn tarballs all extract under a `package/` prefix dir.
  const packageDir = path.join(extractDir, 'package');
  const pkgJsonPath = path.join(packageDir, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  // npm >=7 auto-installs peerDependencies by default, so an unrewritten
  // workspace-sibling peer dep would 404 against the registry just like an
  // unrewritten regular dependency would.
  for (const depsField of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    if (!pkg[depsField]) {
      continue;
    }
    for (const depName of Object.keys(pkg[depsField])) {
      const siblingTgz = siblingTgzPaths[depName];
      if (!siblingTgz) {
        continue;
      }
      if (visiting.has(depName)) {
        throw new Error(`package-metrics: circular workspace dependency detected involving "${depName}"`);
      }
      const siblingDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-sibling-'));
      siblingDirs.push(siblingDir);
      visiting.add(depName);
      const resolvedDir = await extractAndRewrite(siblingTgz, siblingDir, siblingTgzPaths, visiting, siblingDirs);
      visiting.delete(depName);
      pkg[depsField][depName] = `file:${resolvedDir}`;
    }
  }
  await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2));

  return packageDir;
}
