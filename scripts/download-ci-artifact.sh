#!/usr/bin/env bash
set -euo pipefail

name=$1
destination=$2
producer=${3:-}
while IFS=$'\t' read -r artifact_id run_id; do
  run_conclusion=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id" --jq .conclusion)
  job_conclusion=""
  if [ -n "$producer" ]; then
    job_conclusion=$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?per_page=100" \
      --jq ".jobs[] | select(.name == \"$producer\") | .conclusion")
  fi
  if [ "$run_conclusion" = success ] || [ "$job_conclusion" = success ]; then
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
