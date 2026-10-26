#!/usr/bin/env bash
# Posts a commit status that stands in for CLA Assistant's license/cla, so a
# flaky CLA Assistant doesn't block PRs that don't need a CLA.
#
# A PR passes without a CLA when it comes from a branch in this repo and its
# opener and every commit author are org members or allowlisted. Only people
# with write access can push those branches, so forging a commit author doesn't
# get an outside contribution through. Any other PR passes once license/cla is
# success.
set -euo pipefail

CLA_CONTEXT=license/cla
RUN_URL="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"

QUERY='query($owner: String!, $repo: String!, $number: Int!, $endCursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      headRefOid
      commits(first: 100, after: $endCursor) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { commit { author { name user { login } } committer { user { login } } } }
      }
    }
  }
}'

post() {
  gh api -X POST "repos/$GITHUB_REPOSITORY/statuses/$sha" \
    -f state="$1" -f context="$CONTEXT" -f description="${2:0:140}" -f target_url="$RUN_URL" --silent
  echo "$CONTEXT: $1 ($2)"
}

cla_passed() {
  local state
  state=$(gh api --paginate "repos/$GITHUB_REPOSITORY/commits/$sha/status" \
    --jq ".statuses[] | select(.context == \"$CLA_CONTEXT\") | .state")
  [ "$state" = success ]
}

# Matches like CLA Assistant's allowlist: comma-separated patterns where `*`
# matches anything, and a pattern with `*` may match anywhere in the name
allowed() {
  jq -ne --arg list "$ALLOWLIST" --arg name "$1" '$name != "" and ($list | split(",")
    | any(.[] | sub("^\\s+"; "") | sub("\\s+$"; "");
        if contains("*") then
          (gsub("(?<c>[\\^$\\\\.+?()\\[\\]{}|])"; "\\\(.c)") | gsub("\\*"; ".*")) as $regex | $name | test($regex)
        else . == $name end))' > /dev/null
}

# Stops the run when membership can't be read, since counting that as "not a
# member" would hide a broken token behind PRs waiting on CLA Assistant
is_member() {
  local out
  if out=$(GH_TOKEN=$MEMBERS_TOKEN gh api "orgs/$GITHUB_REPOSITORY_OWNER/memberships/$1" --jq .state 2>&1); then
    # Pending invitees haven't joined yet
    [ "$out" = active ]
  elif [[ $out == *"HTTP 404"* ]]; then
    return 1
  else
    echo "::error::Could not read $GITHUB_REPOSITORY_OWNER membership for $1: $out"
    exit 1
  fi
}

case "$GITHUB_EVENT_NAME" in
  status)
    sha=$(jq -r .sha "$GITHUB_EVENT_PATH")
    # Only a signed CLA changes the gate. Ignoring other states keeps them from
    # overriding a pass for a PR that didn't need a CLA
    if jq -e --arg context "$CLA_CONTEXT" '.context == $context and .state == "success"' "$GITHUB_EVENT_PATH" > /dev/null; then
      post success "CLA Assistant reports the CLA is signed"
    fi
    exit 0
    ;;
  pull_request_target) ;;
  *)
    echo "::error::Run on pull_request_target and status events, not $GITHUB_EVENT_NAME"
    exit 1
    ;;
esac

sha=$(jq -r .pull_request.head.sha "$GITHUB_EVENT_PATH")
number=$(jq -r .pull_request.number "$GITHUB_EVENT_PATH")
opener=$(jq -r .pull_request.user.login "$GITHUB_EVENT_PATH")
head_repo=$(jq -r '.pull_request.head.repo.full_name // ""' "$GITHUB_EVENT_PATH")

reasons=()
if [ "$head_repo" != "$GITHUB_REPOSITORY" ]; then
  reasons+=("PR is from a fork")
elif ! { allowed "$opener" || is_member "$opener"; }; then
  reasons+=("opener $opener isn't a member of $GITHUB_REPOSITORY_OWNER")
else
  pages=$(gh api graphql --paginate -f owner="$GITHUB_REPOSITORY_OWNER" -f repo="${GITHUB_REPOSITORY#*/}" \
    -F number="$number" -f query="$QUERY")
  head=$(jq -rs '.[0].data.repository.pullRequest.headRefOid' <<< "$pages")
  if [ "$head" != "$sha" ]; then
    echo "The PR head moved to $head, so the run for that push posts its status"
    exit 0
  fi

  # GitHub caps how many commits a PR lists, so uncounted commits need a CLA check
  if ! jq -se '([.[].data.repository.pullRequest.commits.nodes[]] | length)
      == .[0].data.repository.pullRequest.commits.totalCount' <<< "$pages" > /dev/null; then
    reasons+=("PR has too many commits to check")
  fi

  # Picks the person for each commit like CLA Assistant does: the author's
  # account, else the committer's account, else the author's name
  people=$(jq -rs '[.[].data.repository.pullRequest.commits.nodes[].commit
    | if .author.user then ["login", .author.user.login]
      elif .committer.user then ["login", .committer.user.login]
      else ["name", .author.name] end] | unique[] | join("\u001f")' <<< "$pages")
  while IFS=$'\x1f' read -r kind name; do
    if allowed "$name" || { [ "$kind" = login ] && is_member "$name"; }; then
      continue
    fi
    reasons+=("commit author $name isn't a member of $GITHUB_REPOSITORY_OWNER")
  done <<< "$people"
fi

if [ ${#reasons[@]} -eq 0 ]; then
  post success "Opener and commit authors are $GITHUB_REPOSITORY_OWNER members or allowlisted"
  exit 0
fi

for reason in "${reasons[@]}"; do
  echo "::notice::Needs $CLA_CONTEXT: $reason"
done
if cla_passed; then
  post success "CLA Assistant reports the CLA is signed"
  exit 0
fi
post pending "Waiting for $CLA_CONTEXT: ${reasons[0]}"

# CLA Assistant may have reported since the check above, and the run for its
# status event may have posted before this one did
if cla_passed; then
  post success "CLA Assistant reports the CLA is signed"
fi
