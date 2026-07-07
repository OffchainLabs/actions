import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';
import { sumDirSize } from '../fsSize.mjs';

/**
 * Measure the on-disk `node_modules` footprint of installing an already-packed
 * tarball in an isolated scratch directory.
 *
 * Any dependency name that matches a key in `siblingTgzPaths` (i.e. another
 * package discovered and packed in this same run) has its version specifier
 * rewritten to a `file:` reference pointing at that sibling's own tgz, so a
 * `workspace:*` dependency that pnpm/yarn rewrote to a real-but-unpublished
 * version doesn't trigger a registry lookup that would 404.
 *
 * @param {string} tgzPath - path to the already-packed tarball (from `pack.mjs`)
 * @param {Record<string, string>} [siblingTgzPaths] - map of package name ->
 *   absolute path to that package's own already-packed tgz, for every other
 *   package discovered in this run
 * @returns {Promise<{ installSize: number|null, error: string|null }>}
 *   Never throws — any failure (including a genuinely external, unpublished,
 *   non-sibling dependency) is caught and surfaced as `{ error }` with
 *   `installSize: null`.
 */
export async function installSize(tgzPath, siblingTgzPaths = {}) {
  let extractDir;
  let scratchDir;
  try {
    extractDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-installsize-extract-'));
    // Shell out to the system `tar` binary (always present on GitHub-hosted
    // runners) instead of depending on the `tar` npm package.
    await exec.exec('tar', ['-xf', tgzPath, '-C', extractDir]);

    // npm/pnpm/yarn tarballs all extract under a `package/` prefix directory
    // (verified against real tarballs from all three managers during Phase 2
    // research).
    const packageDir = path.join(extractDir, 'package');
    const pkgJsonPath = path.join(packageDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

    // `peerDependencies` are deliberately NOT rewritten here: a plain `npm
    // install` doesn't auto-install peer deps the way it does regular and
    // optional deps, so rewriting them would have no effect on the measured
    // install size — this is a scope decision, not an oversight.
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

    // Install directly from the (rewritten) extracted directory rather than
    // re-packing. Critically, `--install-links` is required here: npm's
    // default behavior for a <folder> target *outside* the installing
    // project's root is to create a symlink to that folder and skip
    // installing ITS OWN dependencies entirely (confirmed against `npm help
    // install`: "If <folder> sits outside the root of your project, npm will
    // not install the package dependencies in the directory <folder>, but it
    // will create a symlink to <folder>... If you want to install the
    // content of a directory like a package from the registry instead of
    // creating a link, you would need to use the --install-links option.").
    // Without this flag, the sibling `file:` rewrite above would never
    // actually be exercised (no dependency resolution happens at all), and
    // `installSize` would only measure a symlink instead of a real install.
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
