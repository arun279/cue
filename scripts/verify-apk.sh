#!/usr/bin/env bash
# Usage: verify-apk.sh <apk> <expected-version-code> <expected-version-name> [line]
#
# What the packaged APK actually says about itself: the version testers see,
# every permission the phone will show them, and the two backup properties
# PRIVACY.md, docs/index.html and README.md all promise. AGP's
# output-metadata.json and the merged-manifest report are the build's own account
# of what it configured, so they agree with a build that resolved any of it
# wrong; the APK is what gets installed.
#
# The permission set is a merge result, not a repo file: any dependency's
# manifest can add to it, and a `tools:node="remove"` can silently stop applying.
# So the merged set is pinned here, exactly, and a new one fails the build rather
# than shipping unannounced.
#
# `line` is `capacitor` (the default, and the line that ships today) or `expo`.
# The two build genuinely different sets and there is no honest way to write one
# list that covers both: see the comments on each.
set -euo pipefail

apk=$1
expected_code=$2
expected_name=$3
line=${4:-capacitor}

# Every permission the Capacitor line's own manifest declares or accepts from a
# plugin.
#   INTERNET                                 Trakt, declared by hand
#   POST_NOTIFICATIONS                       episode reminders (API 33+ runtime ask)
#   RECEIVE_BOOT_COMPLETED, WAKE_LOCK        the notification plugin's alarm receiver
#   DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION AGP's own, injected for targetSdk >= 33
# SCHEDULE_EXACT_ALARM is absent deliberately: android/app/src/main/AndroidManifest.xml
# removes it, and its absence here is what proves the removal still applies.
capacitor_permissions="android.permission.INTERNET
android.permission.POST_NOTIFICATIONS
android.permission.RECEIVE_BOOT_COMPLETED
android.permission.WAKE_LOCK
app.cuetracker.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

# The Expo line's set, measured off its first release prebuild rather than
# assumed. All five above survive for the same reasons, and two are new:
#   ACCESS_NETWORK_STATE  firebase-messaging, which expo-notifications depends on
#                         whether or not an app uses push. Cue never asks for a
#                         push token, so nothing in that library runs; the
#                         permission is normal-level and auto-granted, and
#                         blocking it would make the FCM code path throw if it
#                         ever did run. Recorded rather than removed.
#   ACCESS_WIFI_STATE     expo-network, which fills the connectivity port. This
#                         one the app does use, through getNetworkStateAsync, so
#                         it is kept rather than blocked: the library reads the
#                         Wi-Fi state to answer, and a blocked permission it
#                         actually holds is a crash rather than a smaller set.
# Twenty-five other permissions arrive from the same dependency tree and are
# dropped in app.config.ts, which explains each one: the Expo template's four
# optional ones, expo-secure-store's biometric pair, and expo-notifications'
# push receive, install-referrer binding and per-OEM launcher badge set.
# SYSTEM_ALERT_WINDOW is re-declared by the debug flavour for the development
# menu, so a debug APK of this line carries it and a release APK does not.
expo_permissions="android.permission.ACCESS_NETWORK_STATE
android.permission.ACCESS_WIFI_STATE
android.permission.INTERNET
android.permission.POST_NOTIFICATIONS
android.permission.RECEIVE_BOOT_COMPLETED
android.permission.WAKE_LOCK
app.cuetracker.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

case "$line" in
  capacitor) expected_permissions=$capacitor_permissions ;;
  expo) expected_permissions=$expo_permissions ;;
  *)
    echo "verify-apk: unknown line '$line'; expected 'capacitor' or 'expo'." >&2
    exit 1
    ;;
esac

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
aapt2=$(printf '%s\n' "$sdk/build-tools"/*/aapt2 | sort -V | tail -n 1)
if [ ! -x "$aapt2" ]; then
  echo "verify-apk: no aapt2 under '$sdk/build-tools'; set ANDROID_HOME or ANDROID_SDK_ROOT to an SDK with build-tools installed." >&2
  exit 1
fi

badging=$("$aapt2" dump badging "$apk")
package_line=${badging%%$'\n'*}
attribute() { sed -n "s/.*$1='\([^']*\)'.*/\1/p" <<<"$package_line"; }
code=$(attribute versionCode)
name=$(attribute versionName)

if [ "$code" != "$expected_code" ] || [ "$name" != "$expected_name" ]; then
  echo "verify-apk: $apk is $name ($code), expected $expected_name ($expected_code)." >&2
  exit 1
fi

# `uses-permission-sdk-23:` and a maxSdkVersion suffix are the same request in a
# narrower window, so the pattern takes those too rather than letting one hide.
permissions=$(sed -n "s/^uses-permission[a-z0-9-]*: name='\([^']*\)'.*/\1/p" <<<"$badging" | sort)
if [ "$permissions" != "$(sort <<<"$expected_permissions")" ]; then
  echo "verify-apk: $apk asks for a permission set this repo has not accounted for." >&2
  echo "expected:" >&2
  sort <<<"$expected_permissions" >&2
  echo "actual:" >&2
  printf '%s\n' "$permissions" >&2
  exit 1
fi

manifest=$("$aapt2" dump xmltree --file AndroidManifest.xml "$apk")

if ! grep -q 'android:allowBackup([^)]*)=false' <<<"$manifest"; then
  echo "verify-apk: $apk does not set android:allowBackup=false, so Google Drive backup and adb backup are on." >&2
  exit 1
fi

# Presence of the attribute says nothing about the file it points at, so the
# rules are read out of the APK too. AGP shortens resource file paths in a
# release build, which is why the id is resolved through the resource table
# rather than guessed from the source file name.
rules_id=$(sed -n 's/.*android:dataExtractionRules([^)]*)=@\(0x[0-9a-f]*\).*/\1/p' <<<"$manifest")
if [ -z "$rules_id" ]; then
  echo "verify-apk: $apk names no dataExtractionRules, so device-to-device transfer copies everything." >&2
  exit 1
fi

rules_path=$("$aapt2" dump resources "$apk" |
  grep -A1 "resource $rules_id " |
  sed -n 's/.*(file) \(res\/[^ ]*\) type=XML.*/\1/p' |
  head -n 1)
if [ -z "$rules_path" ]; then
  echo "verify-apk: $apk names dataExtractionRules $rules_id, which resolves to no XML file." >&2
  exit 1
fi

rules=$("$aapt2" dump xmltree --file "$rules_path" "$apk")

if grep -q '^ *E: include' <<<"$rules"; then
  echo "verify-apk: $rules_path carries an <include>, which turns its section back into an allowlist." >&2
  exit 1
fi

# Every storage domain the platform can name, excluded whole from both channels.
# Counted rather than pattern-matched per section, because a rule that excludes
# nine domains from one channel and eight from the other is exactly the shape
# this is here to catch.
for domain in root file database sharedpref external device_root device_file device_database device_sharedpref; do
  excluded=$(grep -c "A: domain=\"$domain\"" <<<"$rules" || true)
  if [ "$excluded" != "2" ]; then
    echo "verify-apk: $rules_path excludes domain '$domain' from $excluded of the two backup channels, expected both." >&2
    exit 1
  fi
done

whole=$(grep -c 'A: path="\."' <<<"$rules" || true)
if [ "$whole" != "18" ]; then
  echo "verify-apk: $rules_path has $whole whole-domain exclusions, expected 18 (nine domains, two channels)." >&2
  exit 1
fi

echo "verify-apk: $apk is $name ($code) on the $line line, asking for $(wc -l <<<"$permissions" | tr -d ' ') permissions, with backup off and every storage domain excluded from both channels."
