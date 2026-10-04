#!/usr/bin/env bash
set -euo pipefail

app=$1
: "${EXPO_PUBLIC_TRAKT_CLIENT_ID:?the app throws at startup without a Trakt client id}"
: "${EXPO_PUBLIC_TRAKT_API_BASE:?the harness app must be pointed at the fake Trakt origin}"
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ios-bundle.XXXXXX")
entitlements="$work/entitlements.plist"
mkdir -p "$work/assets"
(
  cd packages/native
  npx expo export:embed --platform ios --dev false \
    --entry-file ../../node_modules/expo-router/entry.js \
    --bundle-output "$work/main.jsbundle" --assets-dest "$work/assets"
)
scripts/compile-hermes.sh "$work/main.jsbundle" "$work/main.hbc"
cp "$work/main.hbc" "$app/main.jsbundle"
rsync -a --delete "$work/assets/assets/" "$app/assets/"
codesign -d --entitlements :- "$app" > "$entitlements"
codesign -f -s - --entitlements "$entitlements" "$app"
