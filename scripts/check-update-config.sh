#!/usr/bin/env bash
# Usage: check-update-config.sh <apk|ipa> <channel> <runtime-version>
#
# EAS Build writes the profile's channel into the native project after prebuild,
# so the app config never shows it, and the fingerprint policy leaves the runtime
# as "file:fingerprint" in native config with the hash in a bundled `fingerprint`
# file. The packaged binary is the only place to see which channel and runtime an
# install asks for updates with.
set -euo pipefail

artifact=$1
expected_channel=$2
expected_runtime=$3
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

case "$artifact" in
  *.apk)
    sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
    aapt2=$(printf '%s\n' "$sdk/build-tools"/*/aapt2 | sort -V | tail -n 1)
    "$aapt2" dump xmltree --file AndroidManifest.xml "$artifact" > "$work/manifest"
    meta() {
      grep -A1 "\"expo.modules.updates.$1\"" "$work/manifest" |
        sed -n 's/.*:value([^)]*)=\(.*\)$/\1/p' |
        sed 's/^"\(.*\)" (Raw: .*/\1/' || true
    }
    headers=$(meta UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY)
    runtime=$(meta EXPO_RUNTIME_VERSION)
    if [[ "$runtime" == @0x* ]]; then
      runtime=$("$aapt2" dump resources "$artifact" | grep -A1 "resource ${runtime#@} " |
        sed -n 's/^ *() "\(.*\)"$/\1/p')
    fi
    fingerprint=assets/fingerprint
    ;;
  *.ipa)
    unzip -p "$artifact" 'Payload/*.app/Expo.plist' > "$work/Expo.plist"
    headers=$(plutil -extract EXUpdatesRequestHeaders json -o - "$work/Expo.plist" 2>/dev/null || true)
    runtime=$(plutil -extract EXUpdatesRuntimeVersion raw -o - "$work/Expo.plist" 2>/dev/null || true)
    fingerprint='Payload/*.app/EXUpdates.bundle/fingerprint'
    ;;
  *)
    echo "check-update-config: $artifact is neither an .apk nor an .ipa." >&2
    exit 1
    ;;
esac

if [ "$runtime" = "file:fingerprint" ]; then
  runtime=$(unzip -p "$artifact" "$fingerprint" 2>/dev/null || true)
fi
channel=$(jq -r '."expo-channel-name" // empty' <<<"${headers:-null}")

if [ "$channel" != "$expected_channel" ] || [ "$runtime" != "$expected_runtime" ]; then
  echo "check-update-config: $artifact asks for updates on channel '$channel' with runtime '$runtime', expected '$expected_channel' and '$expected_runtime'." >&2
  exit 1
fi
echo "check-update-config: $artifact asks for updates on channel '$channel' with runtime '$runtime'."
