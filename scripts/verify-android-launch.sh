#!/usr/bin/env bash
set -euo pipefail

apk=$1
logcat=$2

capture_logcat() {
  adb logcat -d -v threadtime > "$logcat" || true
}

: > "$logcat"
trap capture_logcat EXIT

adb install "$apk"
adb shell am force-stop app.cuetracker
adb logcat -c
launch_status=0
timeout 120 adb shell am start -W -n app.cuetracker/.MainActivity > "$logcat.launch" 2>&1 || launch_status=$?
cat "$logcat.launch"
capture_logcat

if [ "$launch_status" -ne 0 ]; then
  echo "Activity launch failed with status $launch_status" >&2
  cat "$logcat" >&2
  exit "$launch_status"
fi
if ! grep -q '^Status: ok' "$logcat.launch"; then
  multiplier=$(adb shell getprop ro.hw_timeout_multiplier | tr -d '\r')
  echo "The activity was not drawn within Android's launch idle timeout, 10 s times ro.hw_timeout_multiplier (${multiplier:-1})" >&2
  cat "$logcat" >&2
  exit 1
fi
if grep -Eq 'FATAL EXCEPTION|AndroidRuntime.*Process: app\.cuetracker|Process: app\.cuetracker' "$logcat"; then
  grep -n -C 20 -E 'FATAL EXCEPTION|AndroidRuntime|Process: app\.cuetracker' "$logcat" >&2
  exit 1
fi

pid=$(adb shell pidof app.cuetracker | tr -d '\r' || true)
if [ -z "$pid" ]; then
  echo "app.cuetracker is not running after launch" >&2
  cat "$logcat" >&2
  exit 1
fi
echo "app.cuetracker is alive as PID $pid"
