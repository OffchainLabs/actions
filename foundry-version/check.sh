#!/usr/bin/env bash
# Checks that every Foundry pin in the repo names the same release, then flags
# a newer stable release with a non-blocking "Foundry needs updating" check.
set -euo pipefail

sources=() # "<file>\t<version>" for every place Foundry gets installed

# A foundry-toolchain step without a version installs stable, so count it as unpinned.
shopt -s nullglob
for file in .github/workflows/*.yml .github/workflows/*.yaml; do
  versions=$(yq '.jobs[]?.steps[]? | select((.uses // "") | test("^foundry-rs/foundry-toolchain@")) | (.with.version // "unpinned")' "$file")
  while IFS= read -r version; do
    if [ -n "$version" ]; then
      sources+=("$file"$'\t'"$version")
    fi
  done <<< "$versions"
done

while IFS= read -r file; do
  [ -n "$file" ] || continue
  if [ ! -f "$file" ]; then
    echo "::error::foundryup file not found: $file"
    exit 1
  fi
  versions=$(grep -oE 'foundryup[[:space:]]+(--install|-i)[[:space:]]+v?[0-9]+\.[0-9]+\.[0-9]+' "$file" \
    | grep -oE '[0-9]+\.[0-9]+\.[0-9]+$' || true)
  for version in ${versions:-unpinned}; do
    sources+=("$file"$'\t'"$version")
  done
done <<< "$FOUNDRYUP_FILES"

if [ ${#sources[@]} -eq 0 ]; then
  echo "::error::No foundry-rs/foundry-toolchain steps found in .github/workflows"
  exit 1
fi

# The latest release endpoint excludes prereleases and nightlies.
latest=$(gh api repos/foundry-rs/foundry/releases/latest --jq .tag_name)
latest=${latest#v}

{
  echo "| source | version |"
  echo "|---|---|"
  printf '%s\n' "${sources[@]}" | sort -u | while IFS=$'\t' read -r file version; do
    echo "| \`$file\` | \`$version\` |"
  done
  echo "| latest stable | \`$latest\` |"
} >> "$GITHUB_STEP_SUMMARY"

# All pins must match, otherwise jobs build and snapshot with different compilers.
pinned=$(printf '%s\n' "${sources[@]}" | cut -f2 | sed 's/^v//' | sort -u)
if ! [[ "$pinned" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error::Expected every Foundry pin to name the same release; found: ${pinned//$'\n'/, }"
  exit 1
fi

up_to_date=false
if [ "$pinned" = "$latest" ]; then
  up_to_date=true
fi
{
  echo "pinned=$pinned"
  echo "latest=$latest"
  echo "up-to-date=$up_to_date"
} >> "$GITHUB_OUTPUT"

if [ "$up_to_date" = true ]; then
  echo "Foundry is up to date at $pinned"
  exit 0
fi

echo "::warning::Foundry $latest is available; CI is pinned to $pinned"

# Flag the update separately without failing this job. Fork PRs get a read-only
# token, so fall back to the warning above when the check can't be created.
jq -n \
  --arg sha "$HEAD_SHA" \
  --arg title "Foundry $latest available (pinned $pinned)" \
  --arg summary "CI pins Foundry \`$pinned\`. The latest stable release is \`$latest\`. Update every pin together. $UPDATE_HINT" \
  '{
    name: "Foundry needs updating",
    head_sha: $sha,
    status: "completed",
    conclusion: "action_required",
    output: { title: $title, summary: ($summary | rtrimstr(" ")) }
  }' \
| gh api -X POST "repos/$GITHUB_REPOSITORY/check-runs" --input - --silent \
|| echo "::warning::Could not create the \"Foundry needs updating\" check; the token may be read-only"
