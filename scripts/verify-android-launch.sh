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
adb shell am start -W -n app.cuetracker/.MainActivity || launch_status=$?
sleep 10
capture_logcat

if [ "$launch_status" -ne 0 ]; then
  echo "Activity launch failed with status $launch_status" >&2
  exit "$launch_status"
fi
if grep -Eq 'FATAL EXCEPTION|AndroidRuntime.*Process: app\.cuetracker|Process: app\.cuetracker' "$logcat"; then
  grep -n -C 20 -E 'FATAL EXCEPTION|AndroidRuntime|Process: app\.cuetracker' "$logcat" >&2
  exit 1
fi

pid=$(adb shell pidof app.cuetracker | tr -d '\r')
if [ -z "$pid" ]; then
  echo "app.cuetracker is not running after launch" >&2
  exit 1
fi
echo "app.cuetracker is alive as PID $pid"
