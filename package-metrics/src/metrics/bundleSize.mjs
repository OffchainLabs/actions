import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

/**
 * Fully bundle a package's primary entry point (including its dependencies —
 * not externalized, per the locked-in decision that this metric represents
 * real consumer impact) and measure the resulting size, minified and gzipped.
 *
 * @param {string} pkgPath - absolute path to the package directory
 * @returns {Promise<{ bundleSize: number|null, bundleSizeGzip: number|null, error: string|null }>}
 *   Never throws — an unresolvable entry point or a build failure (e.g. a
 *   syntax error) is caught and surfaced as `{ error }` with both sizes `null`.
 */
export async function bundleSize(pkgPath) {
  try {
    const entry = resolveEntry(pkgPath);
    const result = await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      write: false,
      absWorkingDir: pkgPath,
      // Without this, esbuild defaults to `platform: 'browser'`, which can't
      // resolve `node:`-prefixed built-ins (or bare built-in names like `fs`)
      // pulled in directly or transitively — and this action measures
      // Node.js npm packages specifically, so bundling must target Node.
      platform: 'node',
    });
    const buffers = result.outputFiles.map((file) => Buffer.from(file.contents));
    const bundleSize = buffers.reduce((sum, buf) => sum + buf.length, 0);
    const bundleSizeGzip = gzipSync(Buffer.concat(buffers)).length;
    return { bundleSize, bundleSizeGzip, error: null };
  } catch (err) {
    return { bundleSize: null, bundleSizeGzip: null, error: err.message };
  }
}

/**
 * Resolve the entry point from the package's own package.json:
 * `main` -> `module` -> `exports['.']` (default condition) -> `index.js` fallback.
 */
function resolveEntry(pkgPath) {
  const pkgJsonPath = path.join(pkgPath, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

  const candidates = [];
  if (typeof pkg.main === 'string') {
    candidates.push(pkg.main);
  }
  if (typeof pkg.module === 'string') {
    candidates.push(pkg.module);
  }
  const exportsDot = pkg.exports?.['.'];
  if (typeof exportsDot === 'string') {
    candidates.push(exportsDot);
  } else if (exportsDot && typeof exportsDot === 'object') {
    const conditionValue = exportsDot.default ?? exportsDot.import ?? exportsDot.require;
    if (typeof conditionValue === 'string') {
      candidates.push(conditionValue);
    }
  }
  candidates.push('index.js');

  for (const candidate of candidates) {
    const resolved = path.resolve(pkgPath, candidate);
    if (existsSync(resolved)) {
      return resolved;
    }
  }
  throw new Error(
    `package-metrics: could not resolve an entry point for "${pkgPath}" (tried: ${candidates.join(', ')})`,
  );
}
