import { readFileSync } from 'node:fs';

// Hand-rolled equivalent of @actions/github's `context` — only the fields
// this action uses, read from GitHub's default env vars, to avoid depending
// on @actions/github (which pulls in the whole octokit tree).
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
