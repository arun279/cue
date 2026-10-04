#!/usr/bin/env bash
set -euo pipefail

aab=$1
apk=$2
keystore=$3
: "${EXPO_PUBLIC_TRAKT_CLIENT_ID:?the app throws at startup without a Trakt client id}"
: "${EXPO_PUBLIC_TRAKT_API_BASE:?the harness app must be pointed at the fake Trakt origin}"
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/android-bundle.XXXXXX")
mkdir -p "$work/aab/base/assets" "$work/apk/assets"
(
  cd packages/native
  npx expo export:embed --platform android --dev false \
    --entry-file ../../node_modules/expo-router/entry.js \
    --bundle-output "$work/index.android.bundle" --assets-dest "$work/assets"
)
scripts/compile-hermes.sh "$work/index.android.bundle" "$work/index.android.hbc"
cp "$work/index.android.hbc" "$work/aab/base/assets/index.android.bundle"
cp "$work/index.android.hbc" "$work/apk/assets/index.android.bundle"
zip -q -d "$aab" 'META-INF/*' base/assets/index.android.bundle || true
(cd "$work/aab" && zip -q -0 "$aab" base/assets/index.android.bundle)
jarsigner -keystore "$keystore" -storepass android -keypass android \
  -sigalg SHA256withRSA -digestalg SHA-256 "$aab" androiddebugkey

unsigned="$work/unsigned.apk"
aligned="$work/aligned.apk"
cp "$apk" "$unsigned"
zip -q -d "$unsigned" 'META-INF/*' assets/index.android.bundle || true
(cd "$work/apk" && zip -q -0 "$unsigned" assets/index.android.bundle)
zipalign=$(find "$ANDROID_HOME/build-tools" -type f -name zipalign -print | sort -V | tail -n 1)
apksigner=$(find "$ANDROID_HOME/build-tools" -type f -name apksigner -print | sort -V | tail -n 1)
"$zipalign" -P 16 -f 4 "$unsigned" "$aligned"
"$apksigner" sign --ks "$keystore" --ks-pass pass:android --key-pass pass:android "$aligned"
cp "$aligned" "$apk"
