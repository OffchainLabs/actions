import { mkdtemp, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';
import { detectPackageManager } from './detectPackageManager.mjs';
import { sumDirSize } from './fsSize.mjs';

/**
 * Pack a single package with whichever package manager owns it, always
 * producing a real `.tgz` on disk (even for npm, which could otherwise use
 * `--dry-run`) so the same result can be reused by both `packedSize.mjs` and
 * `installSize.mjs` without packing twice: the intended caller (Phase 3's
 * orchestrator) calls `pack()` exactly ONCE per package, derives
 * `packedSize.mjs`'s metric from the returned object (a pure, no-I/O
 * selector — see that module), and passes the same object's `tgzPath` to
 * `installSize.mjs`.
 *
 * @param {string} pkgPath - absolute path to the package directory
 * @param {string} workspaceRoot - boundary root passed straight through to
 *   `detectPackageManager` (see that module's docs for why this is required)
 * @returns {Promise<{ packedSize: number|null, unpackedSize: number|null, tgzPath: string|null, error: string|null, cleanup: () => Promise<void> }>}
 *   Never throws — any failure is caught and surfaced as `{ error }` with the
 *   other fields `null`, per the "never fail the job" policy. `cleanup` is
 *   always present and safe to call even after a failure (it's a no-op in
 *   that case, since the temp dir is already removed) — see the return
 *   statement below for the cleanup contract.
 */
export async function pack(pkgPath, workspaceRoot) {
  let tmpDir;
  try {
    const manager = detectPackageManager(pkgPath, workspaceRoot);
    tmpDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-pack-'));

    let result;
    if (manager === 'pnpm') {
      result = await packPnpm(pkgPath, tmpDir);
    } else if (manager === 'yarn-berry') {
      result = await packYarnBerry(pkgPath, tmpDir);
    } else {
      // yarn-classic has no `workspace:`/`catalog:` protocol concept, and
      // plain npm (with or without a lockfile) needs no special handling
      // either — both go through the same plain `npm pack` flow.
      result = await packNpm(pkgPath, tmpDir);
    }
    // `pack()` deliberately does NOT remove `tmpDir` (which holds `tgzPath`)
    // on the success path — the caller needs the tgz afterward. Ownership of
    // cleanup is handed to the caller via this `cleanup` function: it must be
    // called once `tgzPath` is no longer needed by ANY consumer (i.e. after
    // both the packedSize extraction and installSize's install step have
    // used it), typically by Phase 3's orchestrator.
    return { ...result, cleanup: () => rm(tmpDir, { recursive: true, force: true }).catch(() => {}) };
  } catch (err) {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
    return {
      packedSize: null,
      unpackedSize: null,
      tgzPath: null,
      error: err.message,
      cleanup: () => Promise.resolve(),
    };
  }
}

async function packNpm(pkgPath, tmpDir) {
  const { exitCode, stdout, stderr } = await exec.getExecOutput(
    'npm',
    ['pack', '--json', '--pack-destination', tmpDir],
    { cwd: pkgPath, ignoreReturnCode: true },
  );
  if (exitCode !== 0) {
    throw new Error(`package-metrics: npm pack failed (exit ${exitCode}): ${(stderr || stdout).trim()}`);
  }
  // Real (non-`--dry-run`) `npm pack --json` reports the same `size`/
  // `unpackedSize`/`filename` fields as `--dry-run` did — verified empirically
  // against the monorepo fixture during Phase 2 research.
  const [result] = JSON.parse(stdout);
  const tgzPath = path.join(tmpDir, result.filename);
  return { packedSize: result.size, unpackedSize: result.unpackedSize, tgzPath, error: null };
}

async function packPnpm(pkgPath, tmpDir) {
  const { exitCode, stdout, stderr } = await exec.getExecOutput(
    'corepack',
    ['pnpm', '--dir', pkgPath, 'pack', '--json', '--pack-destination', tmpDir],
    { ignoreReturnCode: true },
  );
  if (exitCode !== 0) {
    throw new Error(`package-metrics: pnpm pack failed (exit ${exitCode}): ${(stderr || stdout).trim()}`);
  }
  // pnpm's `--json` output is `{ name, version, filename, files: [{ path }] }`
  // with no size fields (verified empirically against the pnpm-monorepo
  // fixture during Phase 2 research — confirms Phase 0's finding). `filename`
  // is already an absolute path in pnpm's output (unlike npm's, which is bare).
  const result = JSON.parse(stdout);
  const tgzPath = path.isAbsolute(result.filename) ? result.filename : path.join(tmpDir, result.filename);
  return await statAndExtract(tgzPath);
}

async function packYarnBerry(pkgPath, tmpDir) {
  // Yarn Berry (2+) has no `--cwd` flag at all (confirmed against
  // `corepack yarn --help` during Phase 2 research — this contradicts the
  // plan text, which assumed a `--cwd` flag mirroring pnpm's `--dir`; only
  // Yarn *Classic* (1.x) has `--cwd`). Instead, run the process with its
  // working directory set to `pkgPath` via the exec options, exactly like a
  // plain `cd pkgPath && yarn pack` would — Yarn Berry resolves the active
  // workspace from the process cwd. Verified end-to-end against a throwaway
  // Yarn Berry workspace (this repo's fixtures don't include a yarn-berry
  // fixture) that `workspace:*` gets rewritten to a real version in the
  // packed tarball's package.json, same as pnpm.
  const tgzPath = path.join(tmpDir, 'out.tgz');
  const { exitCode, stdout, stderr } = await exec.getExecOutput(
    'corepack',
    ['yarn', 'pack', '--out', tgzPath],
    { cwd: pkgPath, ignoreReturnCode: true },
  );
  if (exitCode !== 0) {
    throw new Error(`package-metrics: yarn pack failed (exit ${exitCode}): ${(stderr || stdout).trim()}`);
  }
  return await statAndExtract(tgzPath);
}

async function statAndExtract(tgzPath) {
  const packedSize = statSync(tgzPath).size;
  const extractDir = await mkdtemp(path.join(tmpdir(), 'package-metrics-extract-'));
  try {
    // Shell out to the system `tar` binary (always present on GitHub-hosted
    // runners) instead of depending on the `tar` npm package.
    await exec.exec('tar', ['-xf', tgzPath, '-C', extractDir]);
    const unpackedSize = sumDirSize(extractDir);
    return { packedSize, unpackedSize, tgzPath, error: null };
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}
