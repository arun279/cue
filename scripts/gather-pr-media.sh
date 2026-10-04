#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/gather-pr-media.sh <run-id> <base-sha> <head-sha> <out-dir>'
run=${1:?$usage}
base_sha=${2:?$usage}
head_sha=${3:?$usage}
out=${4:?$usage}
repo=$GITHUB_REPOSITORY
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
lanes=(
  "ui-screenshots-ios-light-detail:native-e2e-ios-light (detail)"
  "ui-screenshots-ios-light-activity:native-e2e-ios-light (activity)"
  "ui-screenshots-ios-light-discovery:native-e2e-ios-light (discovery)"
  "ui-screenshots-ios-dark:ui-screenshots-ios-dark"
  "ui-screenshots-android-light:android-e2e"
  "ui-screenshots-android-dark:ui-screenshots-android-dark"
)

ended() {
  case $1 in
    failure) echo failed ;;
    cancelled | skipped) echo "was $1" ;;
    in_progress | queued | waiting) echo "is still ${1/_/ }" ;;
    "") echo "did not run" ;;
    *) echo "ended $1" ;;
  esac
}

collect() {
  local side=$1 run=$2
  local link="[run $run](https://github.com/$repo/actions/runs/$run)" jobs artifacts
  jobs=$(gh api --paginate "repos/$repo/actions/runs/$run/jobs?per_page=100" \
    --jq '.jobs[] | [.name, .conclusion // .status] | @tsv')
  artifacts=$(gh api --paginate "repos/$repo/actions/runs/$run/artifacts?per_page=100" \
    --jq '.artifacts[] | [.name, .id, .expired] | @tsv')
  for lane in "${lanes[@]}"; do
    local artifact=${lane%%:*} job=${lane#*:} state id expired note=""
    state=$(awk -F '\t' -v job="$job" '$1 == job { print $2 }' <<< "$jobs")
    read -r id expired <<< "$(awk -F '\t' -v name="$artifact" '$1 == name { print $2, $3 }' <<< "$artifacts")"
    if [ "$expired" = true ]; then
      note="are missing because they expired from $link"
    elif [ -z "$id" ]; then
      note="are missing because the $job job $(ended "$state") in $link"
    else
      gh api "repos/$repo/actions/artifacts/$id/zip" > "$work/artifact.zip"
      mkdir -p "$work/$side"
      unzip -q "$work/artifact.zip" -d "$work/$side/$artifact"
      [ "$state" = success ] || note="may be incomplete because the $job job $(ended "$state") in $link"
    fi
    printf '%s\t%s\t%s\n' "$side" "$artifact" "$note" >> "$work/lanes.tsv"
  done
}

collect after "$run"
base_run=$(gh api "repos/$repo/actions/workflows/ci.yml/runs?head_sha=$base_sha&event=push&per_page=1" \
  --jq '.workflow_runs[0].id // empty')
if [ -n "$base_run" ]; then
  collect before "$base_run"
else
  for lane in "${lanes[@]}"; do
    printf 'before\t%s\tare missing because no push run of CI exists for base %s\n' \
      "${lane%%:*}" "${base_sha:0:7}" >> "$work/lanes.tsv"
  done
fi
node "$(dirname "$0")/compare-screenshots.mjs" "$work" "$out" "$base_sha" "$head_sha"
