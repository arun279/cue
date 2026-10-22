#!/usr/bin/env bash
# Prepares the booted emulator the way the Android device lanes do, with animations left on,
# signs in with Maestro, stops Maestro's driver so nothing reads the app's views while it is
# measured, and runs the performance probe on one APK, or on a base and a changed APK in
# alternate passes. Usage: perf-probe-android.sh <output directory> <runs> <apk> [changed apk]
set -euo pipefail

output=$1
runs=$2
shift 2
mkdir -p "$output"
mock_pid=""
finish() {
  adb logcat -d -v threadtime > "$output/logcat.txt" || true
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
adb reverse tcp:8790 tcp:8790
bash scripts/verify-android-launch.sh "$1" "$output/logcat.txt"
adb shell cmd uimode night no
adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS
anr_dialog='adb shell dumpsys window windows | grep -q "Application Not Responding"'
if ! timeout 10 bash -c "while $anr_dialog; do :; done"; then
  echo "A system not-responding dialog still covers the screen after closing system dialogs" >&2
  exit 1
fi
bash scripts/maestro-test.sh test .maestro/perf/sign-in.yaml --debug-output "$output/maestro-sign-in"
adb shell am force-stop dev.mobile.maestro
adb shell am force-stop dev.mobile.maestro.test
export PERF_MOCK_LOG="$output/mock-trakt.log"
if [ "$#" -gt 1 ]; then
  node scripts/perf-probe.mjs android "$output" "$runs" "$@"
else
  node scripts/perf-probe.mjs android "$output" "$runs"
fi
