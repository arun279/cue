#!/usr/bin/env bash
# Refuses unless every check named in .github/required-checks.json ran on SHA
# and every run of it, re-run attempts included, succeeded.
# https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${SHA:?SHA is required}"

pages=$(gh api --paginate --slurp "repos/$REPO/commits/$SHA/check-runs?filter=all&per_page=100")
failures=$(jq -r --argjson pages "$pages" '
  [$pages[].check_runs[]] as $runs | .[] as $name |
  [$runs[] | select(.name == $name)] as $attempts |
  if ($attempts | length) == 0 then "\($name): missing"
  else $attempts[] | select(.status != "completed" or .conclusion != "success") |
    "\($name): \(.conclusion // .status)" end' "$(dirname "$0")/../.github/required-checks.json")
if [ -n "$failures" ]; then
  echo "::error::Refusing to ship $SHA:"
  echo "$failures"
  exit 1
fi
echo "Every required check passed in every run on $SHA"
