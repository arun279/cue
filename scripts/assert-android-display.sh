#!/usr/bin/env bash
set -euo pipefail

adb shell dumpsys window displays > "$1"
cutout=$(grep -m1 -o 'mDisplayCutout=DisplayCutout{insets=Rect([^)]*)' "$1" || echo 'no mDisplayCutout line')
display="$cutout navigation_mode=$(adb shell settings get secure navigation_mode | tr -d '\r')"
echo "Emulator display: $display"
if [ "$display" != 'mDisplayCutout=DisplayCutout{insets=Rect(0, 144 - 0, 0) navigation_mode=0' ]; then
  echo "Emulator display drifted: $display" >&2
  exit 1
fi
