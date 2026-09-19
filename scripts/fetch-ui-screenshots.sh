#!/usr/bin/env bash
set -euo pipefail

target=${1:?Usage: scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>}
destination=${2:?Usage: scripts/fetch-ui-screenshots.sh <pr-number-or-run-id> <dir>}

if head_sha=$(gh pr view "$target" --json headRefOid --jq .headRefOid 2>/dev/null); then
  run_id=$(gh run list --workflow ci.yml --commit "$head_sha" --limit 1 \
    --json databaseId --jq '.[0].databaseId')
else
  run_id=$target
fi

test -n "$run_id"
mkdir -p "$destination"
gh run download "$run_id" --name ui-screenshots-ios --dir "$destination/screenshots/ios"
gh run download "$run_id" --name ui-screenshots-android --dir "$destination/screenshots/android"
