# CLA gate

Reusable workflow that posts a commit status to stand in for CLA Assistant's `license/cla` as the required CLA check, so a flaky CLA Assistant doesn't block PRs that don't need a CLA.

- Passes a PR into the default branch from a branch in the repo when its opener and every commit author are active org members or on CLA Assistant's allowlist
- Any other PR, such as one from a fork, waits with a `pending` status until CLA Assistant reports `license/cla` as `success`. The `status` event from CLA Assistant re-runs the gate
- A PR with more commits than GitHub lists also waits for `license/cla`

It picks the person behind each commit and matches the allowlist the same way CLA Assistant does:

- The commit author's GitHub account, else the committer's account, else the author's name. `Co-authored-by` trailers aren't checked
- Allowlist patterns are comma-separated, and `*` matches anything. A pattern with `*` matches anywhere in the name, so `bot*` also matches `robot`

Only people with write access can push branches in the repo, so faking a member as a commit's author doesn't get an outside contribution through. This relies on everyone with write access being an org member. An outside collaborator with write access could push commits authored as a member.

## Keeping the app key safe

- The key is a secret in the repo's `cla-gate` environment, which only gives it to runs on the default branch. A workflow pushed to another branch, or run for a PR, can't read it
- Only the `members` job uses the environment, and it only runs for PRs from branches in the repo into the default branch, so it never runs for a fork PR. The `status` job handles every other PR and CLA Assistant's status events without secrets
- The `members` job runs no PR code, and its only action, `actions/create-github-app-token`, is pinned to a commit. It can read the PR but can't write to the repo, and the app token can only read members
- The app is installed on `OffchainLabs/actions` alone, so its token can't read other repos
- Both ways of passing post the same `CLA requirements met` description, and the logs don't say who is or isn't a member, so a public repo doesn't reveal private members

Each run of the `members` job shows on the PR as a deployment to `cla-gate`.

## Setup

Once for the org:

1. Create a GitHub App owned by the org with only the read-only **Members** organization permission and no webhook. `GITHUB_TOKEN` can't see private org members
2. Install it on `OffchainLabs/actions` only, and save its client ID as the `CLA_GATE_CLIENT_ID` organization variable

For each repo:

1. CLA Assistant stays set up, so outside contributors still sign through it
2. Create a `cla-gate` environment. Under deployment branches, allow only the default branch
3. Add the app's private key to that environment as the `CLA_GATE_PRIVATE_KEY` secret. Don't add it as a repo or org secret, which any branch's workflows can read
4. Add the workflow below to the default branch. GitHub runs `status` workflows from there, and `pull_request_target` workflows from the PR's base branch
5. In the default branch's protection, require the `cla-gate` status in place of `license/cla`

## Usage

Pin the workflow to a commit, so changes to it only reach the repo through a reviewed PR.

```yml
name: CLA Gate

on:
  pull_request_target:
    # edited covers base branch changes, which change the PR's commits
    types: [opened, synchronize, reopened, edited]
  status:

permissions:
  contents: read
  pull-requests: read
  statuses: write

jobs:
  cla-gate:
    # Of the status events, only CLA Assistant reporting a signed CLA changes the gate
    if: github.event_name == 'pull_request_target' || (github.event.context == 'license/cla' && github.event.state == 'success')
    uses: OffchainLabs/actions/.github/workflows/cla-gate.yml@<commit-sha>
    with:
      client-id: ${{ vars.CLA_GATE_CLIENT_ID }}
      # The repo's allowlist from its CLA Assistant settings, copied as is
      allowlist: dependabot[bot],github-actions[bot]
    secrets:
      # Resolves to the cla-gate environment's secret in the members job
      CLA_GATE_PRIVATE_KEY: ${{ secrets.CLA_GATE_PRIVATE_KEY }}
```

## Inputs

| Input       | Required | Default    | Description                                                                                                                        |
| ----------- | -------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `client-id` | yes      |            | Client ID of a GitHub App with read-only access to the org's members                                                               |
| `allowlist` | no       |            | The repo's CLA Assistant allowlist, copied as is: comma-separated GitHub logins or commit author names, where `*` matches anything |
| `context`   | no       | `cla-gate` | Name of the commit status to post. Make it a required status check                                                                 |

## Secrets

| Secret                 | Required | Description                                                          |
| ---------------------- | -------- | -------------------------------------------------------------------- |
| `CLA_GATE_PRIVATE_KEY` | yes      | Private key of that GitHub App, stored in the `cla-gate` environment |
