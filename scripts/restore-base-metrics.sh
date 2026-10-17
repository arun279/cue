#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/restore-base-metrics.sh <base-sha>" >&2
  exit 1
fi

BASE_SHA=$1
ARTIFACT_NAME=cue-footprint-$BASE_SHA
git rev-parse --quiet --verify "$BASE_SHA^{commit}" > /dev/null ||
  git fetch --quiet --no-tags origin "$BASE_SHA"
if ! git cat-file -e "$BASE_SHA:packages/native/package.json" 2> /dev/null; then
  jq -n '{sizes: [
    "expo iOS bundle", "expo Android bundle", "Firebase tester APK file", "Play download estimate"
  ] | map({name: ., size: 0})}' > base-metrics.json
  echo "::notice::Merge base $BASE_SHA has no native app, so every delivered artifact starts from zero"
  exit 0
fi
missing() {
  echo "::error::Missing merge-base measurements for $BASE_SHA: $1. Complete the base commit CI run and publish its artifacts before evaluating this diff."
  exit 1
}
run_id=${BASE_CI_RUN_ID:-}
if [ -z "$run_id" ]; then
  runs=$(gh api --paginate --slurp \
    "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=$BASE_SHA&event=push&per_page=100")
  run_id=$(jq -r '[.[].workflow_runs[]] | if length == 1 then .[0].id else empty end' <<<"$runs")
fi
[ -n "$run_id" ] || missing "provide BASE_CI_RUN_ID to identify one base run"
gh run watch "$run_id" --repo "$GITHUB_REPOSITORY" --interval 60 > /dev/null || true
run=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id")
jq -e --arg sha "$BASE_SHA" '.head_sha == $sha and .path == ".github/workflows/ci.yml" and .event == "push" and .status == "completed"' <<<"$run" > /dev/null ||
  missing "run $run_id is not a completed push CI run for the base commit"
jobs=$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?filter=all&per_page=100")
jq -e '[.[].jobs[] | select(.name == "footprint")] |
  length > 0 and all(.status == "completed" and .conclusion == "success")' <<<"$jobs" > /dev/null ||
  missing "run $run_id has missing or unsuccessful footprint jobs"
gh run download "$run_id" --repo "$GITHUB_REPOSITORY" \
  --name "$ARTIFACT_NAME" --dir "$RUNNER_TEMP/base-metrics" ||
  missing "run $run_id has no $ARTIFACT_NAME artifact"
[ -f "$RUNNER_TEMP/base-metrics/head-metrics.json" ] ||
  missing "run $run_id has no head-metrics.json"
cp "$RUNNER_TEMP/base-metrics/head-metrics.json" base-metrics.json
echo "::notice::Restored merge-base measurements from $ARTIFACT_NAME in run $run_id"
