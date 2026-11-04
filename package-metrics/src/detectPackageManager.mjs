import { existsSync } from 'node:fs';
import path from 'node:path';

// Walks up from pkgPath for the nearest lockfile, without crossing
// boundaryRoot (required, so callers can't accidentally pick up an unrelated
// ancestor lockfile).
export function detectPackageManager(pkgPath, boundaryRoot) {
  const boundary = path.resolve(boundaryRoot);
  let dir = path.resolve(pkgPath);

  while (true) {
    const result = detectAt(dir);
    if (result) {
      return result;
    }
    if (dir === boundary) {
      return 'npm';
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
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
