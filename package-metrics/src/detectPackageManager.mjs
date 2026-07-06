import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Walk up from `pkgPath` looking for the nearest lockfile and determine which
 * package manager owns it, without walking past `boundaryRoot`.
 *
 * `boundaryRoot` is a required, explicit parameter (no default) so callers —
 * e.g. Phase 2's orchestrator, which discovers packages under a known
 * workspace/checkout root — must be explicit about where the walk should
 * stop, instead of risking an escape past the intended package/workspace
 * root onto an unrelated ancestor lockfile (e.g. this action's own
 * package-lock.json two directories above a fixture package).
 *
 * @param {string} pkgPath - absolute or relative path to a package directory
 * @param {string} boundaryRoot - absolute or relative path to the outermost
 *   directory the walk is allowed to inspect (inclusive)
 * @returns {'pnpm' | 'yarn-berry' | 'yarn-classic' | 'npm'}
 */
export function detectPackageManager(pkgPath, boundaryRoot) {
  const boundary = path.resolve(boundaryRoot);
  let dir = path.resolve(pkgPath);

  while (true) {
    const result = detectAt(dir);
    if (result) {
      return result;
    }
    if (dir === boundary) {
      // Reached the boundary without finding a lockfile.
      return 'npm';
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      // Reached filesystem root without finding a lockfile or the boundary
      // (boundaryRoot wasn't actually an ancestor of pkgPath).
      return 'npm';
    }
    dir = parent;
  }
}

function detectAt(dir) {
  if (existsSync(path.join(dir, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }
  if (existsSync(path.join(dir, 'yarn.lock'))) {
    return existsSync(path.join(dir, '.yarnrc.yml')) ? 'yarn-berry' : 'yarn-classic';
  }
  if (existsSync(path.join(dir, 'package-lock.json'))) {
    return 'npm';
  }
  return null;
}
