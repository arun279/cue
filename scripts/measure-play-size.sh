#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/measure-play-size.sh <tree>" >&2
  exit 1
fi

head_root=$(git rev-parse --show-toplevel)
tree=$(cd "$1" && pwd)
# The footprint job measures two trees, and a release Android project is several
# gigabytes the runner needs for the next one.
trap 'rm -rf "$tree/packages/native/android"' EXIT
bundletool="$head_root/node_modules/.cache/bundletool-1.18.3.jar"
mkdir -p "$(dirname "$bundletool")"
if [ ! -f "$bundletool" ]; then
  curl --fail --location --retry 3 \
    --output "$bundletool" \
    "https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar"
fi
echo "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29  $bundletool" |
  shasum -a 256 --check >/dev/null

(
  cd "$tree"
  EXPO_PUBLIC_TRAKT_CLIENT_ID=ci APP_VERSION=9.9.9 BUILD_NUMBER=42 \
    pnpm --filter @cue/native exec expo prebuild --platform android --clean >&2
  cd packages/native/android
  ./gradlew bundleRelease >&2
  aab=app/build/outputs/bundle/release/app-release.aab
  echo '{"supportedAbis":["arm64-v8a"],"supportedLocales":["en"],"screenDensity":640,"sdkVersion":35}' > device.json
  java -jar "$bundletool" build-apks --bundle="$aab" --output=all.apks --overwrite >&2
  java -jar "$bundletool" get-size total \
    --apks=all.apks --device-spec=device.json > play-size.csv
  java -jar "$bundletool" get-size total \
    --apks=all.apks --dimensions=ALL > all-size.csv
  node "$head_root/scripts/bundletool-size.mjs" play-size.csv --report \
    "Play download at XXXHDPI ARMv8" >&2
  node "$head_root/scripts/bundletool-size.mjs" all-size.csv --report \
    "Play download maximum across all configurations" >&2
  node "$head_root/scripts/bundletool-size.mjs" play-size.csv --value-only
)
