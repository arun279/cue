#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/restore-base-metrics.sh <base-sha>" >&2
  exit 1
fi

BASE_SHA=$1
ARTIFACT_NAME=cue-footprint-$BASE_SHA
scripts=$(dirname "$0")
git rev-parse --quiet --verify "$BASE_SHA^{commit}" > /dev/null ||
  git fetch --quiet --no-tags origin "$BASE_SHA"
if ! git cat-file -e "$BASE_SHA:packages/native/package.json" 2> /dev/null; then
  jq -n '{sizes: [
    "expo iOS bundle", "expo Android bundle", "Firebase tester APK file", "Play download estimate"
  ] | map({name: ., size: 0})}' > base-metrics.json
  echo "::notice::Merge base $BASE_SHA has no native app, so every delivered artifact starts from zero"
  exit 0
fi
if "$scripts"/download-ci-artifact.sh "$ARTIFACT_NAME" "$RUNNER_TEMP/base-metrics" footprint; then
  cp "$RUNNER_TEMP/base-metrics/head-metrics.json" base-metrics.json
  echo "::notice::Restored merge-base measurements from $ARTIFACT_NAME"
else
  missing() {
    echo "::error::Missing merge-base measurements and successful CI artifacts for $BASE_SHA"
    exit 1
  }
  run_id=$(gh api \
    "repos/$GITHUB_REPOSITORY/actions/workflows/ci.yml/runs?head_sha=$BASE_SHA&event=push&per_page=1" \
    --jq '.workflow_runs[0].id // empty')
  [ -n "$run_id" ] || missing
  # A fingerprint miss measured 35 s of fingerprint plus 1340 s of native-android,
  # the slowest producer; 30 polls a minute apart is that plus about 25 percent.
  for poll in $(seq 30); do
    producers=$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/jobs?per_page=100" \
      --jq '[.jobs[] | select(.name == "check" or .name == "native-android") | .conclusion] |
        if any(. != null and . != "success") then "failed"
        elif map(select(. == "success")) | length == 2 then "ready"
        else "waiting" end')
    [ "$producers" = ready ] && break
    [ "$producers" = waiting ] && [ "$poll" -lt 30 ] || missing
    sleep 60
  done
  gh run download "$run_id" --repo "$GITHUB_REPOSITORY" \
    --name cue-js-bundles --dir "$RUNNER_TEMP/base-native"
  if gh run download "$run_id" --repo "$GITHUB_REPOSITORY" \
    --name cue-native-android-sizes --dir "$RUNNER_TEMP/base-android"; then
    cp "$RUNNER_TEMP/base-android/head-android-sizes.json" \
      "$RUNNER_TEMP/base-android-sizes.json"
  else
    android_artifact=$(gh api \
      "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/artifacts?per_page=100" \
      --jq '.artifacts[] | select(.expired | not) | .name | select(startswith("cue-native-android-") and . != "cue-native-android-sizes")' | head -n 1)
    if [ -z "$android_artifact" ]; then
      echo "::error::Missing Android artifacts for merge base $BASE_SHA"
      exit 1
    fi
    gh run download "$run_id" --repo "$GITHUB_REPOSITORY" \
      --name "$android_artifact" --dir "$RUNNER_TEMP/base-android"
    curl --fail --location --retry 3 \
      --output "$RUNNER_TEMP/bundletool.jar" \
      https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar
    echo "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29  $RUNNER_TEMP/bundletool.jar" | sha256sum --check
    echo '{"supportedAbis":["arm64-v8a"],"supportedLocales":["en"],"screenDensity":640,"sdkVersion":35}' \
      > "$RUNNER_TEMP/base-android/device.json"
    java -jar "$RUNNER_TEMP/bundletool.jar" build-apks \
      --bundle="$RUNNER_TEMP/base-android/app-release.aab" \
      --output="$RUNNER_TEMP/base-android/all.apks" --overwrite
    java -jar "$RUNNER_TEMP/bundletool.jar" get-size total \
      --apks="$RUNNER_TEMP/base-android/all.apks" \
      --device-spec="$RUNNER_TEMP/base-android/device.json" \
      > "$RUNNER_TEMP/base-android/play-size.csv"
    tester_size=$(wc -c < "$RUNNER_TEMP/base-android/tester-arm64-v8a.apk" | tr -d ' ')
    play_size=$(node "$scripts"/bundletool-size.mjs \
      "$RUNNER_TEMP/base-android/play-size.csv" --value-only)
    jq -n --argjson tester "$tester_size" --argjson play "$play_size" \
      '[{name: "Firebase tester APK file", size: $tester}, {name: "Play download estimate", size: $play}]' \
      > "$RUNNER_TEMP/base-android-sizes.json"
  fi
  "$scripts"/measure-sizes.sh "$RUNNER_TEMP/base-native" "$RUNNER_TEMP/base-js-sizes.json"
  jq -s 'add' "$RUNNER_TEMP/base-js-sizes.json" \
    "$RUNNER_TEMP/base-android-sizes.json" > "$RUNNER_TEMP/base-sizes.json"
  jq -n --slurpfile sizes "$RUNNER_TEMP/base-sizes.json" \
    '{sizes: $sizes[0]}' > base-metrics.json
  echo "::notice::Measured merge base $BASE_SHA from CI run $run_id artifacts"
fi
