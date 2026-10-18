#!/usr/bin/env bash
set -euo pipefail

bundletool=$1
artifacts=$2
output=$3
(
  cd "$artifacts"
  echo '{"supportedAbis":["arm64-v8a"],"supportedLocales":["en"],"screenDensity":640,"sdkVersion":35}' > device.json
  java -jar "$bundletool" build-apks --bundle=app-release.aab --output=all.apks --overwrite
  java -jar "$bundletool" get-size total --apks=all.apks --device-spec=device.json > play-size.csv
)
tester=$(wc -c < "$artifacts/tester-arm64-v8a.apk" | tr -d ' ')
play=$(node "$(dirname "$0")/bundletool-size.mjs" "$artifacts/play-size.csv" --value-only)
jq -n --argjson tester "$tester" --argjson play "$play" \
  '[
    {name: "Firebase tester APK file", size: $tester, configuration: "arm64-v8a, all densities"},
    {name: "Play download estimate", size: $play, configuration: "XXXHDPI arm64-v8a, English, Android 15"}
  ]' > "$output"
