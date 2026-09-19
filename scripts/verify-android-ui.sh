#!/usr/bin/env bash
set -euo pipefail

apk=$1
output=$2
mkdir -p "$output"
mock_pid=""

finish() {
  adb logcat -d -v threadtime > "$output/logcat.txt" || true
  adb exec-out screencap -p > "$output/last-state.png" || true
  if [ -n "$mock_pid" ]; then kill "$mock_pid" || true; fi
}
trap finish EXIT

capture() {
  adb exec-out screencap -p > "$output/$1.png"
  adb shell uiautomator dump /sdcard/cue-ui.xml > "$output/$1-dump.log"
  adb exec-out cat /sdcard/cue-ui.xml > "$output/$1.xml"
}

bash scripts/verify-android-launch.sh "$apk" "$output/logcat.txt"
pnpm mock:trakt > "$output/mock-trakt.log" 2>&1 &
mock_pid=$!
ready=0
for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/users/settings > /dev/null; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" -eq 1

unzip -p "$apk" assets/index.android.bundle > "$output/bundle.hbc"
connected=false
if LC_ALL=C grep -aq 'http://10.0.2.2:8787' "$output/bundle.hbc"; then
  maestro test .maestro/flows/launch.yaml --debug-output "$output/maestro-connect"
  connected=true
fi
rm "$output/bundle.hbc"

labels=("Up Next" "Library" "Calendar" "Search")
names=(up-next library calendar search)
for theme in light dark; do
  night=no
  if [ "$theme" = dark ]; then night=yes; fi
  adb shell cmd uimode night "$night"
  adb shell am force-stop app.cuetracker
  adb shell am start -W -n app.cuetracker/.MainActivity
  sleep 3
  if [ "$connected" = true ]; then
    for index in "${!labels[@]}"; do
      name="${names[$index]}-$theme"
      maestro test .maestro/flows/android-tab.yaml --env TAB_LABEL="${labels[$index]}" \
        --debug-output "$output/maestro-$name"
      capture "$name"
      for label in "${labels[@]}"; do
        grep -Fq "text=\"$label\"" "$output/$name.xml" || {
          echo "Missing visible tab label: $label in $name" >&2
          exit 1
        }
      done
      if [ "$index" -ne 0 ]; then
        grep -Fq "${labels[$index]} is coming soon." "$output/$name.xml"
      fi
    done
  else
    capture "onboarding-$theme"
    grep -Fq 'Connect to Trakt' "$output/onboarding-$theme.xml"
  fi
done

if [ "$connected" = true ]; then
  echo 'Captured all four authenticated tabs in light and dark; all four labels asserted in every UI tree.' > "$output/coverage.txt"
else
  echo 'APK has no fake Trakt origin. Captured reachable onboarding in light and dark. Authenticated tabs, marquee, placeholders and the four-label assertion were not exercised. A fake-origin build is required for that coverage.' > "$output/coverage.txt"
fi
cat "$output/coverage.txt" >> "$GITHUB_STEP_SUMMARY"

aapt2=$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 -print | sort -V | tail -n 1)
"$aapt2" dump resources "$apk" > "$output/resources.txt"
for icon in up_next library calendar search; do
  grep -A 1 -F "drawable/cue_tab_$icon" "$output/resources.txt" | grep -q '(file)' || {
    echo "Missing packaged tab drawable: cue_tab_$icon" >&2
    exit 1
  }
done
