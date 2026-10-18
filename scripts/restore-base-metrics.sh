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
run=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id")
jq -e --arg sha "$BASE_SHA" '.head_sha == $sha and .path == ".github/workflows/ci.yml" and .event == "push"' <<<"$run" > /dev/null ||
  missing "run $run_id is not a push CI run for the base commit"
jobs=$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?filter=all&per_page=100")
footprint=$(jq -r '[.[].jobs[] | select(.name == "footprint")] |
  if length > 0 and all(.status == "completed" and .conclusion == "success") then "measured"
  elif any(.status == "completed" and .conclusion != "success") then "failed"
  else "pending" end' <<<"$jobs")
if [ "$footprint" = pending ] && [ "$(jq -r .status <<<"$run")" != completed ]; then
  note="Base measurements are unavailable: the footprint job of base run $run_id had not finished when this job read it, so the size gate cannot pass. Run this job again once that footprint job has finished."
  jq -n --arg note "$note" '{sizes: null, unavailable: $note}' > base-metrics.json
  echo "::warning::$note"
  exit 0
fi
[ "$footprint" = measured ] || missing "run $run_id has missing or unsuccessful footprint jobs"
gh run download "$run_id" --repo "$GITHUB_REPOSITORY" \
  --name "$ARTIFACT_NAME" --dir "$RUNNER_TEMP/base-metrics" ||
  missing "run $run_id has no $ARTIFACT_NAME artifact"
[ -f "$RUNNER_TEMP/base-metrics/head-metrics.json" ] ||
  missing "run $run_id has no head-metrics.json"
cp "$RUNNER_TEMP/base-metrics/head-metrics.json" base-metrics.json
echo "::notice::Restored merge-base measurements from $ARTIFACT_NAME in run $run_id"
