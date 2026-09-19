#!/usr/bin/env bash
set -euo pipefail

name=$1
destination=$2
while IFS=$'\t' read -r artifact_id run_id; do
  if [ "$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" --jq .conclusion)" = success ]; then
    mkdir -p "$destination"
    gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$artifact_id/zip" > "$RUNNER_TEMP/artifact.zip"
    unzip -q "$RUNNER_TEMP/artifact.zip" -d "$destination"
    exit 0
  fi
done < <(
  gh api --paginate "repos/$GITHUB_REPOSITORY/actions/artifacts?name=$name&per_page=100" \
    --jq '.artifacts[] | select(.expired | not) | [.id, .workflow_run.id] | @tsv'
)
exit 1
