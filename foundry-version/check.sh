#!/usr/bin/env bash
# Checks that every Foundry pin in the repo names the same release, then flags
# a newer stable release with a non-blocking "Foundry needs updating" check.
set -euo pipefail

# A foundry-toolchain step without a version installs stable, so count it as unpinned.
pins=$(yq --no-doc '.jobs[]?.steps[]? | select((.uses // "") | test("^foundry-rs/foundry-toolchain@")) | (.with.version // "unpinned")' .github/workflows/*.y*ml)

while IFS= read -r file; do
  [ -n "$file" ] || continue
  version=$(grep -oE 'foundryup[[:space:]]+(--install|-i)[[:space:]]+v?[0-9]+\.[0-9]+\.[0-9]+' "$file" \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$' || true)
  pins+=$'\n'"${version:-unpinned}"
done <<< "$FOUNDRYUP_FILES"

# All pins must match, otherwise jobs build and snapshot with different compilers.
pinned=$(echo "$pins" | sed '/^$/d; s/^v//' | sort -u)
if ! [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  found=${pinned//$'\n'/, }
  echo "::error::Expected one pinned Foundry release; found: ${found:-none}"
  exit 1
fi

# The latest release endpoint excludes prereleases and nightlies.
latest=$(gh api repos/foundry-rs/foundry/releases/latest --jq .tag_name)
latest=${latest#v}

{
  echo "| | version |"
  echo "|---|---|"
  echo "| pinned | \`$pinned\` |"
  echo "| latest stable | \`$latest\` |"
} >> "$GITHUB_STEP_SUMMARY"

if [ "$pinned" = "$latest" ]; then
  echo "Foundry is up to date at $pinned"
  exit 0
fi

echo "::warning::Foundry $latest is available; CI is pinned to $pinned"

# Flag the update separately without failing this job. Fork PRs get a read-only
# token, so fall back to the warning above when the check can't be created.
jq -n \
  --arg sha "$HEAD_SHA" \
  --arg title "Foundry $latest available (pinned $pinned)" \
  --arg summary "CI pins Foundry \`$pinned\`. The latest stable release is \`$latest\`." \
  '{
    name: "Foundry needs updating",
    head_sha: $sha,
    status: "completed",
    conclusion: "action_required",
    output: { title: $title, summary: $summary }
  }' \
| gh api -X POST "repos/$GITHUB_REPOSITORY/check-runs" --input - --silent \
|| echo "::warning::Could not create the \"Foundry needs updating\" check; the token may be read-only"
