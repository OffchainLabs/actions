# Foundry version

Checks that every Foundry pin in a repo names the same release, and flags when a newer stable release is out.

- Reads the `version` of every `foundry-rs/foundry-toolchain` step in `.github/workflows`, plus any `foundryup --install <version>` in the files listed in `foundryup-files`
- Fails if a step is unpinned or the pins disagree
- When the pin is behind the latest stable release, creates a non-blocking `Foundry needs updating` check with an `action_required` conclusion. The job itself still passes

## Usage

```yml
name: Foundry Version

on:
  pull_request:
  workflow_dispatch:

permissions:
  contents: read
  checks: write

jobs:
  foundry-version:
    name: Foundry Version
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: OffchainLabs/actions/foundry-version@main
        with:
          # Optional: other files that pin Foundry via foundryup
          foundryup-files: Dockerfile
```

Requires `yq`, `jq` and `gh`, which GitHub-hosted Ubuntu runners include.
