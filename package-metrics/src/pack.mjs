import { mkdtemp, rm } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as exec from '@actions/exec';
import { detectPackageManager } from './detectPackageManager.mjs';
import { sumDirSize } from './fsSize.mjs';

// Packs a package with whichever manager owns it, always producing a real
// .tgz (even for npm) so the result can be reused by both packedSize and
// installSize without packing twice. Call this exactly once per package, and
// call the returned cleanup() once both consumers are done with tgzPath.
// Never throws.
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
      // yarn-classic and plain npm both go through the same npm pack flow.
      result = await packNpm(pkgPath, tmpDir);
    }
    // tmpDir isn't cleaned up here — the caller needs the tgz afterward.
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
  // pnpm's --json has no size fields, only name/version/filename/files —
  // filename is already absolute here, unlike npm's.
  const result = JSON.parse(stdout);
  const tgzPath = path.isAbsolute(result.filename) ? result.filename : path.join(tmpDir, result.filename);
  return await statAndExtract(tgzPath);
}

async function packYarnBerry(pkgPath, tmpDir) {
  // Yarn Berry has no --cwd flag (only Yarn Classic does) — set cwd via exec
  // options instead; Berry resolves the active workspace from process cwd.
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
    await exec.exec('tar', ['-xf', tgzPath, '-C', extractDir]);
    const unpackedSize = sumDirSize(extractDir);
    return { packedSize, unpackedSize, tgzPath, error: null };
  } finally {
    await rm(extractDir, { recursive: true, force: true }).catch(() => {});
  }
}
