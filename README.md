# Offchain Labs GitHub Actions

A collection of reusable GitHub actions and workflows.

## Publish an npm package

The [`publish-npm`](publish-npm/action.yml) composite action publishes a pnpm package to npm using [trusted publishing](https://docs.npmjs.com/trusted-publishers) and [staged publishing](https://docs.npmjs.com/staged-publishing). 

It accepts stable tags (`v1.2.3`) and `alpha`, `beta`, or `rc` prerelease tags (`v1.2.3-beta.0`), verifies that the tag matches `package.json`, and selects the matching npm dist-tag (`latest`, `alpha`, `beta`, or `rc`). The packed tarball is checked with a dry run before it is staged for publishing.

Configure the calling repository and `.github/workflows/publish-npm.yml` as a trusted publisher on npm, using the `Publish` GitHub environment. The calling workflow is responsible for checking out and building the package before invoking the action:

```yml
name: Publish NPM Package

on:
  push:
    tags:
      - "v*"

jobs:
  publish:
    name: Publish to npm
    runs-on: ubuntu-latest
    environment: Publish
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          persist-credentials: false

      - name: Set up pnpm and Node.js
        uses: pnpm/setup@v1
        with:
          runtime: node@24
          cache: true

      - name: Build
        run: pnpm build

      - name: Publish package
        uses: OffchainLabs/actions/publish-npm@main
        with:
          working-directory: src
```

### Permissions

The calling job must grant these permissions because composite actions cannot declare job-level permissions:

- `contents: read` allows the workflow to check out the repository.
- `id-token: write` allows pnpm to request the GitHub OIDC token required by npm trusted publishing.

With trusted publishing configured, no npm token secret is required.
