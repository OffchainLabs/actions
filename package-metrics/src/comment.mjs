import * as core from '@actions/core';
import { context } from './context.mjs';
import { formatBytes } from './formatBytes.mjs';

// First line of every comment body this module posts/updates — used both to
// render the (invisible, in GitHub's rendered view) marker and to find an
// existing comment to update in place rather than spamming a new one every
// run.
export const MARKER = '<!-- package-metrics-report -->';

/**
 * Pure markdown builder — no network/I/O, so it's directly unit-testable
 * without mocking the GitHub API. Exported separately from `postComment` for
 * that reason.
 *
 * @param {object} result - the same {schemaVersion, commit, timestamp,
 *   packages} object written to the JSON artifact by index.mjs.
 * @param {string} runUrl - link to the workflow run, used for the footer's
 *   "Full JSON report" link (the JSON itself is only available as this run's
 *   uploaded artifact, not inline in the comment).
 * @returns {string} the full markdown comment body.
 */
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

  // The details block is omitted entirely (not just left empty) when there
  // are zero errors across every package — a deliberate per-plan requirement,
  // not just a cosmetic choice.
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

// A package.json "name" isn't restricted from containing "|" — an unescaped
// one would shift/break the markdown table's columns.
function escapeTableCell(value) {
  return value.replace(/\|/g, '\\|');
}

const GITHUB_API_VERSION = '2022-11-28';

/**
 * Hand-rolled REST client for the 3 endpoints this module needs (list/create/
 * update issue comments) — avoids depending on @actions/github, which
 * otherwise pulls in the entire octokit package tree just for this. Node 20's
 * built-in `fetch` is sufficient. See
 * https://docs.github.com/en/rest/issues/comments for the endpoints used.
 */
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
  // Paginate rather than a single request — a long-lived PR can have more
  // than one page (100 per page here) of comments, and the marker comment
  // could be anywhere in that history.
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

/**
 * Posts a new PR comment, or updates the existing one (found via `MARKER`)
 * if this action has already commented on this PR before.
 *
 * Never throws: any failure — a bad/insufficiently-scoped token, a missing
 * `pull-requests: write` permission on the caller's job (a 403), a network
 * error, anything — is caught and surfaced as a `core.warning` only. Per the
 * plan's "never fail the job" policy, a failed comment must never fail (or
 * even mark as failed) the overall run, since the JSON artifact — this
 * feature's primary output — has already been written successfully by the
 * time this is called.
 *
 * @param {object} result - same shape as `buildCommentBody`'s `result` param.
 * @param {string} githubToken - token to authenticate the comment API calls.
 */
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
