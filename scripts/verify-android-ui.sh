#!/usr/bin/env bash
set -euo pipefail

apk=$1
output=$2
screenshots=$3
appearance=$4
suite=${5:-}
mkdir -p "$output"
mkdir -p "$screenshots/$appearance"
mock_pid=""

finish() {
  adb logcat -d -v threadtime > "$output/logcat.txt" || true
  adb exec-out screencap -p > "$output/last-state.png" || true
  if [ -n "$mock_pid" ]; then kill "$mock_pid" || true; fi
}
trap finish EXIT

adb shell settings put global hide_error_dialogs 1
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS
adb shell settings put system font_scale 1.0
adb shell wm size reset
adb shell wm density reset
bash scripts/pin-android-display.sh "$output/window-displays.txt"

mock_pid=$(node scripts/start-ready-process.mjs scripts/mock-trakt/server.mjs "$output/mock-trakt.log")

adb reverse tcp:8787 tcp:8787
bash scripts/verify-android-launch.sh "$apk" "$output/logcat.txt"
result=0
night=no
if [ "$appearance" = dark ]; then night=yes; fi
adb shell cmd uimode night "$night"
adb shell am force-stop app.cuetracker
adb shell am start -W -n app.cuetracker/.MainActivity
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS
flow=.maestro/ci/app-$suite.yaml
if [ "$appearance" = dark ]; then flow=.maestro/ci/screenshots.yaml; fi
if ! bash scripts/maestro-test.sh test "$flow" --driver-host-port 7001 \
  --format JUNIT \
  --output "$output/maestro-results-$appearance.xml" \
  --debug-output "$output/maestro-$appearance" \
  --test-output-dir "$screenshots/$appearance"; then
  result=1
fi

# The activity suite ends on the tab bar, after the account flow.
if [ "$suite" = activity ]; then
  adb shell uiautomator dump /sdcard/cue-ui.xml > "$output/tab-dump.log"
  adb exec-out cat /sdcard/cue-ui.xml > "$output/tabs.xml"
  for label in "Up Next" "Library" "Calendar" "Search"; do
    grep -Fq "text=\"$label\"" "$output/tabs.xml" || {
      echo "Missing visible tab label: $label" >&2
      exit 1
    }
  done
  density=$(adb shell wm density | sed -n 's/^Physical density: //p' | tr -d '\r')
  node scripts/check-label-fit.mjs "$output/tabs.xml" 8 4 "$density" >> "$GITHUB_STEP_SUMMARY"
  aapt2=$(find "$ANDROID_HOME/build-tools" -type f -name aapt2 -print | sort -V | tail -n 1)
  "$aapt2" dump resources "$apk" > "$output/resources.txt"
  for icon in up_next library calendar search; do
    grep -A 1 -F "drawable/cue_tab_$icon" "$output/resources.txt" | grep -q '(file)' || {
      echo "Missing packaged tab drawable: cue_tab_$icon" >&2
      exit 1
    }
  done
  echo 'Ran the shared light activity suite; all four tab labels and drawables are present.' > "$output/coverage.txt"
elif [ "$appearance" = light ]; then
  echo "Ran the shared light $suite suite." > "$output/coverage.txt"
else
  echo 'Ran the shared dark visit and screenshot traversal.' > "$output/coverage.txt"
fi
cat "$output/coverage.txt" >> "$GITHUB_STEP_SUMMARY"

adb shell dumpsys activity exit-info app.cuetracker > "$output/exit-info.txt"
adb logcat -d -v threadtime > "$output/logcat.txt"
bash scripts/assert-no-anr.sh "$output/exit-info.txt" "$output/logcat.txt"
exit "$result"
