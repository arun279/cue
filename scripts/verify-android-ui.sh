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

adb shell settings put global hide_error_dialogs 1

capture() {
  adb exec-out screencap -p > "$output/$1.png"
  adb shell uiautomator dump /sdcard/cue-ui.xml > "$output/$1-dump.log"
  adb exec-out cat /sdcard/cue-ui.xml > "$output/$1.xml"
}

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
maestro test .maestro/flows/lib/connect.yaml --driver-host-port 7001 \
  --debug-output "$output/maestro-connect"

labels=("Up Next" "Library" "Calendar" "Search")
names=(up-next library calendar search)
for theme in light dark; do
  night=no
  if [ "$theme" = dark ]; then night=yes; fi
  adb shell cmd uimode night "$night"
  adb shell am force-stop app.cuetracker
  adb shell am start -W -n app.cuetracker/.MainActivity
  sleep 3
  for index in "${!labels[@]}"; do
    name="${names[$index]}-$theme"
    maestro test .maestro/flows/android-tab.yaml --driver-host-port 7001 \
      --env TAB_LABEL="${labels[$index]}" \
      --debug-output "$output/maestro-$name"
    capture "$name"
    for label in "${labels[@]}"; do
      grep -Fq "text=\"$label\"" "$output/$name.xml" || {
        echo "Missing visible tab label: $label in $name" >&2
        exit 1
      }
    done
    case "${names[$index]}" in
      up-next) ;;
      library) grep -Fq "screen-library" "$output/$name.xml" ;;
      calendar) grep -Fq "screen-calendar" "$output/$name.xml" ;;
      search) grep -Fq "screen-search" "$output/$name.xml" ;;
    esac
  done
done

echo 'Captured all four authenticated tabs in light and dark; all four labels asserted in every UI tree.' > "$output/coverage.txt"
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
