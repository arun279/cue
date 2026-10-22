#!/usr/bin/env bash
# Fetches the mock-server build a CI run measured: the Android universal APK, or the iOS
# simulator app with that run's harness JavaScript. Usage: perf-probe-app.sh <ios|android> <run id> <destination>
set -euo pipefail

platform=$1
run_id=$2
destination=$3
mkdir -p "$destination"

artifacts=$(gh api --paginate "repos/$GITHUB_REPOSITORY/actions/runs/$run_id/artifacts?per_page=100" \
  --jq '.artifacts[] | select(.expired | not) | [.id, .name] | @tsv')
fetch() {
  gh api "repos/$GITHUB_REPOSITORY/actions/artifacts/$1/zip" > "$RUNNER_TEMP/probe-artifact.zip"
  unzip -oq "$RUNNER_TEMP/probe-artifact.zip" -d "$2"
}

if [ "$platform" = android ]; then
  id=$(awk -F'\t' '$2 ~ /^cue-native-android-[0-9a-f]+$/ {print $1; exit}' <<<"$artifacts")
  [ -n "$id" ] || { echo "run $run_id uploaded no Android app" >&2; exit 1; }
  fetch "$id" "$destination"
  test -f "$destination/universal.apk"
  exit 0
fi

# A run that rebuilt the simulator app uploaded it with its own JavaScript. A run that reused a
# cached app uploaded only the harness bundle, kept for a day, which names the cached app it goes into.
id=$(awk -F'\t' '$2 ~ /^cue-native-ios-[0-9a-f]+$/ {print $1; exit}' <<<"$artifacts")
if [ -n "$id" ]; then
  fetch "$id" "$destination"
  tar -xzf "$destination/Cue.app.tgz" -C "$destination"
  exit 0
fi
bundle=$(awk -F'\t' '$2 == "ios-harness-bundle" {print $1; exit}' <<<"$artifacts")
[ -n "$bundle" ] || { echo "run $run_id uploaded neither an iOS app nor a harness bundle" >&2; exit 1; }
fetch "$bundle" "$destination/bundle"
[ -s "$destination/bundle/app-artifact" ] || { echo "run $run_id's harness bundle names no simulator app" >&2; exit 1; }
scripts/download-ci-artifact.sh "$(cat "$destination/bundle/app-artifact")" "$destination" native-ios
tar -xzf "$destination/Cue.app.tgz" -C "$destination"
scripts/reembed-ios.sh "$destination/Cue.app" "$destination/bundle"
