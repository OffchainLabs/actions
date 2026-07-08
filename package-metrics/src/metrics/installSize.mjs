import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';
import { sumDirSize } from '../fsSize.mjs';

// Measures the on-disk node_modules footprint of installing an already-packed
// tarball. Any dependency matching a key in siblingTgzPaths gets rewritten to
// a file: reference to that sibling's own tgz, so a workspace:* dependency
// pnpm/yarn rewrote to a real-but-unpublished version doesn't 404 against the
// registry. Never throws.
export async function installSize(tgzPath, siblingTgzPaths = {}) {
  let extractDir;
  let scratchDir;
  try {
    extractDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-extract-'));
    await exec.exec('tar', ['-xf', tgzPath, '-C', extractDir]);

    // npm/pnpm/yarn tarballs all extract under a `package/` prefix dir.
    const packageDir = path.join(extractDir, 'package');
    const pkgJsonPath = path.join(packageDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

    // peerDependencies aren't rewritten: a plain npm install doesn't
    // auto-install them, so it wouldn't affect the measured size.
    for (const depsField of ['dependencies', 'optionalDependencies']) {
      if (!pkg[depsField]) {
        continue;
      }
      for (const depName of Object.keys(pkg[depsField])) {
        const siblingTgz = siblingTgzPaths[depName];
        if (siblingTgz) {
          pkg[depsField][depName] = `file:${path.resolve(siblingTgz)}`;
        }
      }
    }
    await writeFile(pkgJsonPath, JSON.stringify(pkg, null, 2));

    scratchDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-scratch-'));
    await writeFile(
      path.join(scratchDir, 'package.json'),
      JSON.stringify({ name: 'scratch', version: '0.0.0', private: true }),
    );

    // --install-links is required: npm otherwise symlinks a folder target
    // outside the project root instead of installing its dependencies.
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
  }
}
