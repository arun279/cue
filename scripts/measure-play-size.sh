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
# Gradle bundles through `expo export:embed`, which rewrites .expo/atlas.jsonl
# with its one Android bundle. Measuring a download must not overwrite the
# attribution the two-platform export just produced.
export EXPO_ATLAS=false
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
  play_size=$(node "$head_root/scripts/bundletool-size.mjs" play-size.csv --value-only)

  if grep -q -- '--mode=universal' "$tree/fastlane/Fastfile"; then
    java -jar "$bundletool" build-apks \
      --bundle="$aab" --output=tester.apks --mode=universal --overwrite >&2
    unzip -q tester.apks universal.apk -d tester
    tester_apk=tester/universal.apk
    tester_configuration="universal, all ABIs and densities"
  else
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a >&2
    tester_apk=app/build/outputs/apk/release/app-release.apk
    tester_configuration="arm64-v8a, all densities"
  fi
  tester_size=$(wc -c < "$tester_apk" | tr -d ' ')
  node --input-type=module - "$tree/.size-limit.json" "$tester_size" "$tester_configuration" "$play_size" <<'NODE'
import { readFileSync } from "node:fs";

const [configPath, testerSize, testerConfiguration, playSize] = process.argv.slice(2);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const testerLimit = config.find(({ name }) => name === "Firebase tester APK file")?.limit ?? 0;
process.stdout.write(
  `${JSON.stringify([
    {
      name: "Firebase tester APK file",
      size: Number(testerSize),
      sizeLimit: testerLimit,
      configuration: testerConfiguration,
    },
    {
      name: "Play download estimate",
      size: Number(playSize),
      sizeLimit: 20_000_000,
      configuration: "XXXHDPI arm64-v8a, English, Android 15",
    },
  ])}\n`,
);
NODE
)
