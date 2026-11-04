// Decimal units, e.g. 12345 -> "12.3 KB". Only used for the PR comment
// table; the JSON artifact keeps raw byte counts.
const NA_MARKER = '⚠️ n/a';
const KB = 1000;
const MB = 1000 * 1000;

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) {
    return NA_MARKER;
  }

  if (bytes < KB) {
    return `${bytes} B`;
  }

  if (bytes < MB) {
    return `${(bytes / KB).toFixed(1)} KB`;
  }

  return `${(bytes / MB).toFixed(1)} MB`;
}
