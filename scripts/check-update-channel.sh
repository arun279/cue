#!/usr/bin/env bash
# Usage: check-update-channel.sh <apk|ipa> <channel>
#
# EAS Build writes the profile's channel into the native project after prebuild,
# so the app config never shows it. The packaged binary is the only place to see
# which channel an install will ask for updates on.
set -euo pipefail

artifact=$1
expected=$2

case "$artifact" in
  *.apk)
    sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
    aapt2=$(printf '%s\n' "$sdk/build-tools"/*/aapt2 | sort -V | tail -n 1)
    headers=$("$aapt2" dump xmltree --file AndroidManifest.xml "$artifact" |
      grep -A1 '"expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY"' |
      sed -n 's/.*:value([^)]*)="\(.*\)" (Raw: .*/\1/p' || true)
    ;;
  *.ipa)
    headers=$(unzip -p "$artifact" 'Payload/*.app/Expo.plist' |
      plutil -extract EXUpdatesRequestHeaders json -o - - 2>/dev/null || true)
    ;;
  *)
    echo "check-update-channel: $artifact is neither an .apk nor an .ipa." >&2
    exit 1
    ;;
esac

channel=$(jq -r '."expo-channel-name" // empty' <<<"${headers:-null}")
if [ "$channel" != "$expected" ]; then
  echo "check-update-channel: $artifact asks for updates on channel '$channel', expected '$expected'." >&2
  exit 1
fi
echo "check-update-channel: $artifact asks for updates on channel '$channel'."
