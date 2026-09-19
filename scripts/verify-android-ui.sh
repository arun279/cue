#!/usr/bin/env bash
set -euo pipefail

apk=$1
output=$2
screenshots=$3
mkdir -p "$output"
mkdir -p "$screenshots/light" "$screenshots/dark"
mock_pid=""

finish() {
  adb logcat -d -v threadtime > "$output/logcat.txt" || true
  adb exec-out screencap -p > "$output/last-state.png" || true
  if [ -n "$mock_pid" ]; then kill "$mock_pid" || true; fi
}
trap finish EXIT

adb shell settings put global hide_error_dialogs 1
adb shell settings put system font_scale 1.0
adb shell wm size reset
adb shell wm density reset

node scripts/mock-trakt/server.mjs > "$output/mock-trakt.log" 2>&1 &
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

adb reverse tcp:8787 tcp:8787
bash scripts/verify-android-launch.sh "$apk" "$output/logcat.txt"
result=0
for appearance in light dark; do
  night=no
  if [ "$appearance" = dark ]; then night=yes; fi
  adb shell cmd uimode night "$night"
  adb shell am force-stop app.cuetracker
  adb shell am start -W -n app.cuetracker/.MainActivity
  suite=.maestro/ci/app.yaml
  if [ "$appearance" = dark ]; then suite=.maestro/ci/screenshots.yaml; fi
  if ! maestro test "$suite" --driver-host-port 7001 \
    --format JUNIT \
    --output "$output/maestro-results-$appearance.xml" \
    --debug-output "$output/maestro-$appearance" \
    --test-output-dir "$screenshots/$appearance"; then
    result=1
  fi
done

adb shell uiautomator dump /sdcard/cue-ui.xml > "$output/tab-dump.log"
adb exec-out cat /sdcard/cue-ui.xml > "$output/tabs.xml"
for label in "Up Next" "Library" "Calendar" "Search"; do
  grep -Fq "text=\"$label\"" "$output/tabs.xml" || {
    echo "Missing visible tab label: $label" >&2
    exit 1
  }
done

echo 'Ran the shared suite in light and dark; all four tab labels are present.' > "$output/coverage.txt"
cat "$output/coverage.txt" >> "$GITHUB_STEP_SUMMARY"

aapt2=$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 -print | sort -V | tail -n 1)
"$aapt2" dump resources "$apk" > "$output/resources.txt"
for icon in up_next library calendar search; do
  grep -A 1 -F "drawable/cue_tab_$icon" "$output/resources.txt" | grep -q '(file)' || {
    echo "Missing packaged tab drawable: cue_tab_$icon" >&2
    exit 1
  }
done

adb shell dumpsys activity exit-info app.cuetracker > "$output/exit-info.txt"
adb logcat -d -v threadtime > "$output/logcat.txt"
bash scripts/assert-no-anr.sh "$output/exit-info.txt" "$output/logcat.txt"
exit "$result"
