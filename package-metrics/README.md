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

## Precondition: checkout the PR's head commit, not the merge commit

On `pull_request` events, `actions/checkout` defaults to the auto-generated merge
commit, not the PR branch's actual head commit. This action reports the real head
SHA in its `commit` output regardless, but that's only accurate if the files it
measured were actually that commit's — if your checkout step doesn't pin the ref,
you can end up with a `commit` field that doesn't match what was measured (e.g. if
the base branch moved since the PR was opened). Pin it explicitly:

```yml
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
```

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

To measure specific packages instead of auto-discovering a `packages/` directory,
use `paths` — one relative path per line:

```yml
      - name: Measure package metrics
        uses: OffchainLabs/actions/package-metrics@main
        with:
          is-monorepo: false
          paths: |
            packages/foo
            packages/bar
```

## Inputs

| Name             | Description                                                                                              | Required | Default                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------- |
| `paths`           | Newline-separated list of paths (relative to the workspace root) to packages to measure. Ignored when `is-monorepo` is `true`. | No       | `''`                          |
| `is-monorepo`      | When `true`, auto-discover every package under `<workspace-root>/packages/*` and ignore the `paths` input.        | No       | `false`                        |
| `enable-comment`   | When `true`, post (or update) a PR comment with the results. Requires `permissions: pull-requests: write` on the calling job — see below. | No       | `false`                        |
| `github-token`     | Token used to read/write the PR comment.                                                                            | No       | `${{ github.token }}`          |

## Outputs

| Name          | Description                              |
| -------------- | ----------------------------------------------- |
| `json-path`     | Path to the written JSON report file.            |
| `json`          | The JSON report, stringified.                     |

Always written to `package-metrics-result.json` at the workspace root — this is
intentionally fixed, not configurable, so that scraping this file across many repos
doesn't require discovering a per-repo path first. It's also uploaded as a
`package-metrics-result` workflow artifact on every run that actually collects
metrics — not on runs skipped entirely (fork PRs, see below) or runs that fail before
discovery completes.

The same results table is also written to the run's job summary — visible on the
workflow run page regardless of `enable-comment`, since it needs no extra permissions.

## `enable-comment` requires a job-scoped permission

If you set `enable-comment: true`, that job needs:

```yml
permissions:
  pull-requests: write
```

Only add this to the specific job that enables comments — leave every other job at
the repo's default permissions.

## pnpm / Yarn Berry workspace support

Packages that live in a pnpm or Yarn Berry workspace, and whose `package.json`
declares `workspace:*`/`^`/`~` dependencies on other packages in the same workspace,
are supported automatically. This action detects the package manager per package
(by walking up for the nearest lockfile) and invokes `pnpm pack`/`yarn pack` via
`corepack` — no extra configuration needed, as long as the precondition above
(dependencies already installed) is satisfied. Unpublished workspace siblings are
resolved locally (rewritten to a `file:` reference against that sibling's own packed
tarball) rather than attempting a registry fetch, so `installSize` succeeds even for
packages that have never been published — including transitively, e.g. `c` depending
on `b` depending on `a`, where none of the 3 have ever been published.

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
  "analyzedCommit": "a1b2c3d4e5f6...",
  "runId": 123456789,
  "runUrl": "https://github.com/some-org/some-repo/actions/runs/123456789",
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
- `analyzedCommit` — the actual `git rev-parse HEAD` of the workspace when analysis
  ran, independent of `commit`. If the calling workflow didn't pin its checkout to
  `commit` (see the precondition above), this will differ — that drift is now visible
  directly in the data instead of only in a `core.warning` in the run's log. `null` if
  it couldn't be determined (e.g. no git repo present).
- `runId` / `runUrl` — the run this analysis came from, in the *calling* repo. Lets a
  downstream consumer (or a human investigating a size spike) trace back to that run's
  steps and logs — e.g. to see exactly what `actions/checkout` did.
- `timestamp` — single UTC ISO 8601 timestamp for the whole run.
- `packages` — an array of records, one per discovered package. `name`/`version` come
  from that package's own `package.json` (not its folder name).
- `metrics.*` — raw byte counts. Any metric that failed to collect is `null`, with a
  corresponding entry in that package's `errors` object (keyed by metric name) — a
  metric-collection failure never fails the overall action run.

## Contributing

This repo has no unit test framework (see the rest of the actions in this repo — the
convention here is self-test GitHub Actions workflows, not jest/vitest). Instead,
[`.github/workflows/package-metrics.yml`](../.github/workflows/package-metrics.yml)
runs this action against the fixture packages in
[`__fixtures__/`](./__fixtures__) on every PR to this repo, exercising the action's
own code paths the same way a real consumer would — that's what gives confidence a
change didn't break anything before it ships to `OffchainLabs/actions/package-metrics@main`.

The fixtures:

- `__fixtures__/monorepo/packages/{pkg-a,pkg-b}` — exercises `is-monorepo: true`
  auto-discovery.
- `__fixtures__/single-pkg` — exercises `is-monorepo: false` with an explicit `paths`
  input.
- `__fixtures__/pnpm-monorepo` — a real pnpm workspace with a `pkg-c` → `pkg-b` →
  `pkg-a` chain, all via `workspace:*` — exercises package-manager detection and the
  unpublished-sibling `file:` resolution logic, including transitively.

If you add a new scenario this action needs to handle, add or extend a fixture for it
and a corresponding job in `package-metrics.yml`, following the same pattern.
