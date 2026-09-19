#!/usr/bin/env bash
set -euo pipefail

app=$1
work=$(mktemp -d "$RUNNER_TEMP/ios-bundle.XXXXXX")
entitlements="$work/entitlements.plist"
mkdir -p "$work/assets"
(
  cd packages/native
  npx expo export:embed --platform ios --dev false \
    --entry-file ../../node_modules/expo-router/entry.js \
    --bundle-output "$work/main.jsbundle" --assets-dest "$work/assets"
)
node_modules/hermes-compiler/hermesc/osx-bin/hermesc \
  -emit-binary -O -w -out "$work/main.hbc" "$work/main.jsbundle"
cp "$work/main.hbc" "$app/main.jsbundle"
rsync -a --delete "$work/assets/assets/" "$app/assets/"
codesign -d --entitlements :- "$app" > "$entitlements"
codesign -f -s - --entitlements "$entitlements" "$app"
