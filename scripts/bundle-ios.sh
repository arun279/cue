#!/usr/bin/env bash
set -euo pipefail

out=$1
: "${EXPO_PUBLIC_TRAKT_CLIENT_ID:?the app throws at startup without a Trakt client id}"
: "${EXPO_PUBLIC_TRAKT_API_BASE:?the harness app must be pointed at the fake Trakt origin}"
: "${EXPO_PUBLIC_CLOCK_START:?the harness app must share the fake Trakt clock}"
[ "${EXPO_PUBLIC_UI_HARNESS:-}" = 1 ] || { echo "EXPO_PUBLIC_UI_HARNESS must be 1: the harness app carries the Maestro readiness and timing markers" >&2; exit 1; }
work=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/ios-bundle.XXXXXX")
mkdir -p "$out"
(
  cd packages/native
  npx expo export:embed --platform ios --dev false --minify false \
    --entry-file entry.ts \
    --bundle-output "$work/main.jsbundle" --assets-dest "$out"
)
scripts/compile-hermes.sh "$work/main.jsbundle" "$work/main.hbc"
mv "$work/main.hbc" "$out/main.hbc"
