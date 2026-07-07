// Human-readable byte formatting for the PR comment table only — the JSON
// artifact keeps raw byte counts; this exists purely for comment.mjs's
// rendering. Decimal (1000-based) units are used throughout, not binary
// (1024-based) KiB/MiB — either convention is defensible, decimal was chosen
// so `12345` renders as `12.3 KB` (12345 / 1000 = 12.345, not 12345 / 1024 =
// 12.06), matching the plan's worked example exactly.
const NA_MARKER = '⚠️ n/a';
const KB = 1000;
const MB = 1000 * 1000;

/**
 * @param {number|null} bytes - raw byte count, or null when the metric
 *   failed to collect.
 * @returns {string} human-readable size, or the n/a marker for `null`.
 */
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
