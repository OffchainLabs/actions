# Foundry update

Reusable workflow that opens a PR bumping a repo's pinned Foundry release when a newer stable release is out.

- Compares the pin against the latest stable Foundry release, and skips if they match or a PR for that release is already open
- Bumps the pin, installs the new release, runs `yarn`, then runs the repo's `fix-up` commands, such as `forge fmt` or regenerating snapshots
- Pushes `ci/foundry-update` and opens a PR into the branch the workflow ran on, listing the fix-up commands. If a PR for an older release is still open, it updates that one instead

The workflow uses `GITHUB_TOKEN`, and GitHub doesn't start workflow runs for PRs or pushes made with it. To run CI on the bot's PR, close and reopen it.

## Requirements

- Foundry is installed through a local composite action at `.github/actions/install-foundry/action.yml` that holds the only pin. `GITHUB_TOKEN` can't push changes to files under `.github/workflows`, so the pin can't live there:

  ```yml
  name: Install Foundry
  description: Install the pinned Foundry release
  runs:
    using: composite
    steps:
      - uses: foundry-rs/foundry-toolchain@v1
        with:
          version: v1.8.3
          cache: false
  ```

- The repo uses yarn
- "Allow GitHub Actions to create and approve pull requests" is enabled in the repo's Actions settings

## Usage

```yml
name: Foundry Update

on:
  schedule:
    - cron: "0 5 * * 1"
  workflow_dispatch:

jobs:
  foundry-update:
    uses: OffchainLabs/actions/.github/workflows/foundry-update.yml@main
    permissions:
      contents: write
      pull-requests: write
    with:
      reviewer: your-github-login
      fix-up: |
        forge fmt
        yarn test:storage || true
        yarn test:signatures || true
```

## Inputs

| Input          | Required | Default | Description                                                                       |
| -------------- | -------- | ------- | --------------------------------------------------------------------------------- |
| `fix-up`       | yes      |         | Commands to run with the new Foundry before opening the PR. Listed in the PR body |
| `reviewer`     | no       |         | GitHub login to request review from when a new PR is opened                       |
| `node-version` | no       | `24`    | Node.js version used to install packages with yarn                                |
