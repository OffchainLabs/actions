import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Recursively sum file sizes under `dir` (directories themselves don't
 * count). Shared between `pack.mjs` (unpacked-size measurement) and
 * `installSize.mjs` (`node_modules` footprint measurement).
 *
 * @param {string} dir - absolute path to the directory to sum
 * @returns {number}
 */
export function sumDirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += sumDirSize(entryPath);
    } else if (entry.isFile()) {
      total += statSync(entryPath).size;
    }
  }
  return total;
}
