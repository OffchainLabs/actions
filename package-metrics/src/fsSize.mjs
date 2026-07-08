import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Recursively sums file sizes under dir (directories themselves don't count).
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
