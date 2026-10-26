# CLA gate

Posts a commit status that stands in for CLA Assistant's `license/cla` as the required CLA check, so a flaky CLA Assistant doesn't block PRs that don't need a CLA.

- Passes a PR from a branch in the repo when its opener and every commit author are active org members or on CLA Assistant's allowlist
- Any other PR, such as one from a fork, waits with a `pending` status until CLA Assistant reports `license/cla` as `success`. Fork PRs skip the membership checks entirely. The `status` event from CLA Assistant re-runs the gate
- A PR with more commits than GitHub lists also waits for `license/cla`

It picks the person behind each commit and matches the allowlist the same way CLA Assistant does:

- The commit author's GitHub account, else the committer's account, else the author's name. `Co-authored-by` trailers aren't checked
- Allowlist patterns are comma-separated, and `*` matches anything. A pattern with `*` matches anywhere in the name, so `bot*` also matches `robot`

Only people with write access can push branches in the repo, so faking a member as a commit's author doesn't get an outside contribution through. This relies on everyone with write access being an org member. An outside collaborator with write access could push commits authored as a member.

## Requirements

- CLA Assistant stays set up on the repo, so outside contributors still sign through it
- A GitHub App owned by the org with the read-only **Members** organization permission and no webhook, installed on the org. `GITHUB_TOKEN` can't see private org members. Save its client ID as the `CLA_GATE_CLIENT_ID` variable and its private key as the `CLA_GATE_PRIVATE_KEY` secret
- The workflow is on the default branch. GitHub runs `status` workflows from there, and `pull_request_target` workflows from the PR's base branch
- Branch protection requires the `cla-gate` status in place of `license/cla`

## Usage

The workflow runs with secrets on fork PRs, so it must never check out or run PR code.

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
    runs-on: ubuntu-latest
    steps:
      - uses: OffchainLabs/actions/cla-gate@main
        with:
          client-id: ${{ vars.CLA_GATE_CLIENT_ID }}
          private-key: ${{ secrets.CLA_GATE_PRIVATE_KEY }}
          # The repo's allowlist from its CLA Assistant settings, copied as is
          allowlist: dependabot[bot],github-actions[bot]
```

## Inputs

| Input          | Required | Default               | Description                                                                                                                        |
| -------------- | -------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `client-id`    | yes      |                       | Client ID of a GitHub App installed on the org with read access to members                                                         |
| `private-key`  | yes      |                       | Private key of that GitHub App                                                                                                     |
| `allowlist`    | no       |                       | The repo's CLA Assistant allowlist, copied as is: comma-separated GitHub logins or commit author names, where `*` matches anything |
| `context`      | no       | `cla-gate`            | Name of the commit status to post. Make it a required status check                                                                 |
| `github-token` | no       | `${{ github.token }}` | Token used to read the PR and post the status                                                                                      |

Requires `jq` and `gh`, which GitHub-hosted Ubuntu runners include.
