#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/measure-base.sh <base-tree> <bundletool.jar> <head-android-dir> <out.json>'
tree=${1:?$usage}
bundletool=${2:?$usage}
head_android=${3:?$usage}
output=${4:?$usage}
: "${HEAD_FINGERPRINT:?the Android fingerprint of the head build decides whether the base can reuse its native shell}"
scripts=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/base.XXXXXX")
node "$scripts/measure-complexity.mjs" "$tree" > "$work/complexity.json"
if [ -f "$tree/packages/native/package.json" ]; then
  pnpm --dir "$tree" install --frozen-lockfile
  (
    cd "$tree"
    # The check job exports the store bundles without the harness variables.
    env -u EXPO_PUBLIC_TRAKT_API_BASE -u EXPO_PUBLIC_TRAKT_CLIENT_ID -u EXPO_PUBLIC_UI_HARNESS -u EXPO_PUBLIC_CLOCK_START \
      EXPO_ATLAS=true pnpm --filter @cue/native exec expo export --platform ios --platform android --output-dir dist
    "$scripts/measure-sizes.sh" packages/native "$work/bundle-sizes.json"
    fingerprint=$(pnpm exec node scripts/native-fingerprint.mjs android)
    android=$work/android
    if [ "$fingerprint" = "$HEAD_FINGERPRINT" ]; then
      cp -R "$head_android" "$android"
    elif ! "$scripts/download-ci-artifact.sh" "cue-native-android-$fingerprint" "$android" native-android; then
      pnpm --filter @cue/native exec expo prebuild --platform android --clean
      "$scripts/build-android-release.sh" "$android"
    fi
    "$scripts/reembed-android.sh" "$android/app-release.aab" "$android/tester-arm64-v8a.apk" "$android/debug.keystore"
    "$scripts/measure-android-sizes.sh" "$bundletool" "$android" "$work/android-sizes.json"
    jq -s 'add' "$work/bundle-sizes.json" "$work/android-sizes.json" > "$work/sizes.json"
  )
else
  jq -n '[
    "expo iOS bundle", "expo Android bundle", "Firebase tester APK file", "Play download estimate"
  ] | map({name: ., size: 0})' > "$work/sizes.json"
fi
jq -n --slurpfile sizes "$work/sizes.json" --slurpfile complexity "$work/complexity.json" \
  '{sizes: $sizes[0], complexity: $complexity[0]}' > "$output"
