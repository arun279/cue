#!/usr/bin/env bash
set -euo pipefail

udid=${1:?Usage: scripts/disable-ios-daemons.sh <simulator-udid> [--booted]}
labels=(com.apple.apsd com.apple.chronod)
PATH=$PATH:/usr/libexec

loaded() {
  xcrun simctl spawn "$udid" launchctl list | awk -v wanted=" ${labels[*]} " 'index(wanted, " " $3 " ") { print $3 }'
}

if [ "${2-}" != --booted ]; then
  plist=${DISABLED_STORE_ROOT:-/private/var/tmp}/com.apple.CoreSimulator.SimDevice.$udid/disabled.plist
  mkdir -p "${plist%/*}"
  for label in "${labels[@]}"; do
    PlistBuddy -c "Set :$label true" "$plist" 2>/dev/null || PlistBuddy -c "Add :$label bool true" "$plist"
  done
  exit 0
fi

for label in $(loaded); do
  echo "$label ignored the pre-boot override; disabling it in the booted simulator"
  xcrun simctl spawn "$udid" launchctl disable "system/$label"
  xcrun simctl spawn "$udid" launchctl bootout "system/$label"
done
still=$(loaded)
if [ -n "$still" ]; then
  echo "Simulator daemons still loaded after disabling them: $still" >&2
  exit 1
fi
