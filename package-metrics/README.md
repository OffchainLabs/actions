# Offchain Labs GitHub Actions

Measure npm package size metrics — packed size, unpacked size, bundle size (minified
and gzipped), and install size — across one or more packages, emit a JSON snapshot,
and optionally post (or update) a PR comment with the results.

## Precondition: install your dependencies first

This action **packs** individual packages for measurement — it does not install your
workspace's dependencies. The calling workflow must run its own install step
(`npm ci`, `pnpm install`, `yarn install`, etc.) *before* invoking this action.
Without an already-installed workspace:

- `pnpm pack` / `yarn pack` cannot resolve `workspace:*`/`^`/`~` references.
- The bundle-size step (esbuild) cannot resolve a package's imports.

## Usage

In workflows:

```yml
jobs:
  package-metrics:
    name: Measure package size metrics
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install dependencies
        run: npm ci # or `pnpm install` / `yarn install`, matching your repo

      - name: Measure package metrics
        uses: OffchainLabs/actions/package-metrics@main
        with:
          is-monorepo: true
```

## Inputs

| Name             | Description                                                                                              | Required | Default                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- |
| `paths`           | Newline-separated list of paths (relative to the workspace root) to packages to measure. Ignored when `is-monorepo` is `true`. | No       | `''`                          |
| `is-monorepo`      | When `true`, auto-discover every package under `<workspace-root>/packages/*` and ignore the `paths` input.        | No       | `false`                        |
| `enable-comment`   | When `true`, post (or update) a PR comment with the results. Requires `permissions: pull-requests: write` on the calling job — see below. | No       | `false`                        |
| `github-token`     | Token used to read/write the PR comment.                                                                            | No       | `${{ github.token }}`          |
| `output-path`      | Path to write the resulting JSON report to.                                                                        | No       | `package-metrics-result.json` |

## Outputs

| Name          | Description                              |
| -------------- | ----------------------------------------------- |
| `json-path`     | Path to the written JSON report file.            |
| `json`          | The JSON report, stringified.                     |

The written JSON file is also uploaded as a `package-metrics-result` workflow artifact
on every run that actually collects metrics — not on runs skipped entirely (fork PRs,
see below) or runs that fail before discovery completes.

## `enable-comment` requires a job-scoped permission

`permissions:` blocks are static YAML — this action cannot request write access only
when `enable-comment: true` is passed, since GitHub resolves permissions before the
job runs. **Only the specific job(s) that pass `enable-comment: true` should declare**:

```yml
permissions:
  pull-requests: write
```

Every other job that only wants the size metrics (no comment) should be left at the
repo's default (read-only) token permissions — do not grant this repo-/workflow-wide.
If the permission is missing, the action does not fail the job: it logs a
`core.warning` and the JSON artifact is still produced.

## pnpm / Yarn Berry workspace support

Packages that live in a pnpm or Yarn Berry workspace, and whose `package.json`
declares `workspace:*`/`^`/`~` dependencies on other packages in the same workspace,
are supported automatically. This action detects the package manager per package
(by walking up for the nearest lockfile) and invokes `pnpm pack`/`yarn pack` via
`corepack` — no extra configuration needed, as long as the precondition above
(dependencies already installed) is satisfied. Unpublished workspace siblings are
resolved locally (rewritten to a `file:` reference against that sibling's own packed
tarball) rather than attempting a registry fetch, so `installSize` succeeds even for
packages that have never been published.

## Fork PRs are skipped entirely

When triggered by a `pull_request` event from a fork (i.e. the PR's head repository
isn't this repository), this action skips the run entirely — no package discovery, no
packing, no metrics, no artifact, and no comment attempt. This is a deliberate
cost-saving guard: maintainers of public repos should not expect size feedback on
external/fork-originated contributions.

## Output JSON schema

```json
{
  "schemaVersion": 1,
  "commit": "a1b2c3d4e5f6...",
  "timestamp": "2026-07-06T14:32:01.000Z",
  "packages": [
    {
      "name": "@offchainlabs/some-pkg",
      "version": "1.2.3",
      "path": "/absolute/path/to/packages/some-pkg",
      "metrics": {
        "packedSize": 12345,
        "unpackedSize": 34567,
        "bundleSize": 45678,
        "bundleSizeGzip": 15234,
        "installSize": 5123456
      },
      "errors": {}
    }
  ]
}
```

- `schemaVersion` — increments if this shape ever changes in a breaking way. Consumers
  (e.g. a future artifact-scraping/Grafana ingestion job) should check this field.
- `commit` — the real commit SHA: the PR's head SHA on `pull_request` events, never
  the ephemeral merge commit GitHub synthesizes for the run.
- `timestamp` — single UTC ISO 8601 timestamp for the whole run.
- `packages` — an array of records, one per discovered package. `name`/`version` come
  from that package's own `package.json` (not its folder name).
- `metrics.*` — raw byte counts. Any metric that failed to collect is `null`, with a
  corresponding entry in that package's `errors` object (keyed by metric name) — a
  metric-collection failure never fails the overall action run.
