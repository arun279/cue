#!/usr/bin/env bash
set -euo pipefail

expected='mDisplayCutout=DisplayCutout{insets=Rect(0, 144 - 0, 0) navigation_mode=0'
display() {
  adb shell dumpsys window displays > "$1"
  cutout=$(grep -m1 -o 'mDisplayCutout=DisplayCutout{insets=Rect([^)]*)' "$1" || echo 'no mDisplayCutout line')
  echo "$cutout navigation_mode=$(adb shell settings get secure navigation_mode | tr -d '\r')"
}
export -f display

adb shell cmd overlay enable com.android.internal.emulation.pixel_7_pro
adb shell cmd overlay enable com.android.systemui.emulation.pixel_7_pro
if ! timeout 30 bash -c 'until [ "$(display "$0")" = "$1" ]; do :; done' "$1" "$expected"; then
  echo "Emulator display did not settle within 30 s" >&2
fi
state=$(display "$1")
echo "Emulator display: $state"
if [ "$state" != "$expected" ]; then
  echo "Emulator display drifted: $state" >&2
  exit 1
fi
