import * as core from '@actions/core';
import { context } from './context.mjs';
import { formatBytes } from './formatBytes.mjs';

// Marks this action's comments so they can be found and updated in place.
export const MARKER = '<!-- package-metrics-report -->';

// Pure markdown builder — no I/O, so it's directly unit-testable.
export function buildCommentBody(result, runUrl) {
  const shortSha = result.commit.slice(0, 7);

  const rows = result.packages.map((pkg) => {
    const { packedSize, unpackedSize, bundleSize, bundleSizeGzip, installSize } = pkg.metrics;
    const name = escapeTableCell(pkg.name);
    return `| \`${name}\` | ${formatBytes(packedSize)} | ${formatBytes(unpackedSize)} | ${formatBytes(bundleSize)} | ${formatBytes(bundleSizeGzip)} | ${formatBytes(installSize)} |`;
  });

  const errorLines = [];
  for (const pkg of result.packages) {
    for (const [metric, message] of Object.entries(pkg.errors ?? {})) {
      errorLines.push(`- \`${escapeTableCell(pkg.name)}\`: ${metric} — ${message}`);
    }
  }

  const lines = [
    MARKER,
    '## 📦 Package Metrics Report',
    '',
    `Commit \`${shortSha}\` · ${result.timestamp}`,
    '',
    '| Package | Packed | Unpacked | Bundle | Bundle (gzip) | Install |',
    '|---|---|---|---|---|---|',
    ...rows,
    '',
  ];

  // Omitted entirely (not just empty) when there are zero errors.
  if (errorLines.length > 0) {
    lines.push(
      '<details>',
      `<summary>⚠️ ${errorLines.length} metric collection error(s)</summary>`,
      '',
      ...errorLines,
      '',
      '</details>',
      '',
    );
  }

  lines.push(`[Full JSON report →](${runUrl})`);

  return lines.join('\n');
}

// An unescaped "|" in a package name would break the markdown table.
function escapeTableCell(value) {
  return value.replace(/\|/g, '\\|');
}

const GITHUB_API_VERSION = '2022-11-28';

// Hand-rolled REST client for the 3 endpoints this needs, using Node's
// built-in fetch instead of depending on @actions/github/octokit.
async function githubApiRequest(token, method, path, body) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': 'package-metrics-action',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${method} ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.status === 204 ? null : response.json();
}

async function listAllComments(token, owner, repo, issueNumber) {
  const comments = [];
  for (let page = 1; ; page++) {
    const pageOfComments = await githubApiRequest(
      token,
      'GET',
      `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    comments.push(...pageOfComments);
    if (pageOfComments.length < 100) {
      return comments;
    }
  }
}

// Posts a new comment, or updates the existing one found via MARKER. Never
// throws — any failure (bad token, missing permission, network) degrades to
// a core.warning, since the JSON artifact is already written by this point.
export async function postComment(result, githubToken) {
  try {
    const { owner, repo } = context.repo;
    const issue_number = context.issue.number;
    const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`;

    const body = buildCommentBody(result, runUrl);

    const comments = await listAllComments(githubToken, owner, repo, issue_number);
    const existing = comments.find((c) => c.body?.includes(MARKER));

    if (existing) {
      await githubApiRequest(githubToken, 'PATCH', `/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        body,
      });
    } else {
      await githubApiRequest(githubToken, 'POST', `/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
        body,
      });
    }
  } catch (err) {
    core.warning(`package-metrics: failed to post/update PR comment — ${err.message}`);
  }
}
