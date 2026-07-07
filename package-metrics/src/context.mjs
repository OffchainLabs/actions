import { readFileSync } from 'node:fs';

/**
 * Hand-rolled equivalent of @actions/github's `context` export — only the
 * handful of fields this action actually reads (eventName, sha, payload,
 * repo, issue.number, runId, serverUrl). Reimplemented directly from
 * documented GitHub Actions default environment variables instead of
 * depending on @actions/github, which otherwise pulls in the entire octokit
 * package tree just for this. See
 * https://docs.github.com/en/actions/learn-github-actions/variables#default-environment-variables
 * — all of these are always set by the runner, for every trigger type.
 */
function readPayload() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) {
    return {};
  }
  return JSON.parse(readFileSync(eventPath, 'utf8'));
}

const payload = readPayload();
const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? '/').split('/');

export const context = {
  eventName: process.env.GITHUB_EVENT_NAME,
  sha: process.env.GITHUB_SHA,
  payload,
  repo: { owner, repo },
  issue: {
    number: payload.pull_request?.number ?? payload.issue?.number ?? payload.number,
  },
  runId: Number(process.env.GITHUB_RUN_ID),
  serverUrl: process.env.GITHUB_SERVER_URL ?? 'https://github.com',
};
