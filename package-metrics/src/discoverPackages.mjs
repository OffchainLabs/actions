import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Discover the set of packages to measure for this run.
 *
 * @param {object} options
 * @param {string} options.workspaceRoot - absolute path to the checkout root
 * @param {boolean} options.isMonorepo - when true, auto-discover under
 *   `<workspaceRoot>/packages/*` and ignore `paths`
 * @param {string} options.paths - newline-separated list of paths relative to
 *   `workspaceRoot`, used only when `isMonorepo` is false
 * @returns {Array<{ name: string, version: string, path: string }>}
 */
export function discoverPackages({ workspaceRoot, isMonorepo, paths }) {
  const candidateDirs = isMonorepo
    ? discoverMonorepoDirs(workspaceRoot)
    : discoverExplicitDirs(workspaceRoot, paths);

  const packages = [];
  for (const dir of candidateDirs) {
    const pkg = readPackageJson(dir);
    if (!pkg) {
      continue;
    }
    if (!pkg.name) {
      console.warn(`package-metrics: skipping "${dir}" — its package.json has no "name" field`);
      continue;
    }
    packages.push({ name: pkg.name, version: pkg.version, path: dir });
  }

  if (packages.length === 0) {
    throw new Error(
      isMonorepo
        ? `package-metrics: no packages found under "${path.join(workspaceRoot, 'packages')}" — check that the directory exists and contains package.json files`
        : 'package-metrics: no packages found — check that the "paths" input is set and points to valid package directories',
    );
  }

  return packages;
}

function discoverMonorepoDirs(workspaceRoot) {
  const packagesRoot = path.join(workspaceRoot, 'packages');

  let entries;
  try {
    entries = readdirSync(packagesRoot, { withFileTypes: true });
  } catch (err) {
    console.warn(`package-metrics: could not read "${packagesRoot}": ${err.message}`);
    return [];
  }

  const dirs = [];
  for (const entry of entries) {
    const entryPath = path.join(packagesRoot, entry.name);
    if (!entry.isDirectory()) {
      console.warn(`package-metrics: skipping "${entryPath}" — not a directory`);
      continue;
    }
    if (!existsSync(path.join(entryPath, 'package.json'))) {
      console.warn(`package-metrics: skipping "${entryPath}" — no package.json found`);
      continue;
    }
    dirs.push(entryPath);
  }
  return dirs;
}

function discoverExplicitDirs(workspaceRoot, paths) {
  const relativePaths = (paths ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return relativePaths.map((relativePath) => {
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    if (!existsSync(absolutePath)) {
      throw new Error(
        `package-metrics: configured path "${relativePath}" does not exist (resolved to "${absolutePath}")`,
      );
    }
    if (!statSync(absolutePath).isDirectory()) {
      throw new Error(
        `package-metrics: configured path "${relativePath}" is not a directory (resolved to "${absolutePath}")`,
      );
    }
    return absolutePath;
  });
}

function readPackageJson(dir) {
  const pkgJsonPath = path.join(dir, 'package.json');
  if (!existsSync(pkgJsonPath)) {
    console.warn(`package-metrics: skipping "${dir}" — no package.json found`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`package-metrics: failed to parse "${pkgJsonPath}": ${err.message}`);
  }
}
