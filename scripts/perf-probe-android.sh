#!/usr/bin/env bash
# Prepares the booted emulator the way the Android device lanes do, with animations left on,
# signs in with Maestro, stops Maestro's driver so nothing reads the app's views while it is
# measured, and runs the performance probe. Usage: perf-probe-android.sh <apk> <output directory> <runs>
set -euo pipefail

apk=$1
output=$2
runs=$3
mkdir -p "$output"
mock_pid=""
finish() {
  adb logcat -d -v threadtime > "$output/logcat.txt" || true
  if [ -n "$mock_pid" ]; then kill "$mock_pid" || true; fi
}
trap finish EXIT

adb shell settings put global hide_error_dialogs 1
adb shell settings put system font_scale 1.0
adb shell wm size reset
adb shell wm density reset
node scripts/pin-android-display.mjs "$output/window-displays.txt"
mock_pid=$(node scripts/start-ready-process.mjs scripts/mock-trakt/server.mjs "$output/mock-trakt.log")
adb reverse tcp:8787 tcp:8787
adb reverse tcp:8790 tcp:8790
bash scripts/verify-android-launch.sh "$apk" "$output/logcat.txt"
bash scripts/maestro-test.sh test .maestro/perf/sign-in.yaml --debug-output "$output/maestro-sign-in"
adb shell am force-stop dev.mobile.maestro
adb shell am force-stop dev.mobile.maestro.test
node scripts/perf-probe.mjs android "$output" "$runs"
