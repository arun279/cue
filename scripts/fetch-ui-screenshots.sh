#!/usr/bin/env bash
set -euo pipefail

target=${1:?Usage: scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>}
destination=${2:?Usage: scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>}

if head_sha=$(gh pr view "$target" --json headRefOid --jq .headRefOid 2>/dev/null); then
  runs=$("$(dirname "$0")/ci-runs.sh" "$head_sha")
  run_id=${runs%%$'\t'*}
else
  run_id=$target
fi

test -n "$run_id"
gh run download "$run_id" --pattern 'ui-*' --dir "$destination"
