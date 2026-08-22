#!/usr/bin/env bash
# Usage: verify-apk.sh <apk> <expected-version-code> <expected-version-name>
#
# What the packaged APK actually says about itself: the version testers see, and
# every permission the phone will show them. AGP's output-metadata.json and the
# merged-manifest report are the build's own account of what it configured, so
# they agree with a build that resolved either one wrong; the APK is what gets
# installed.
#
# The permission set is a merge result, not a repo file: any dependency's
# manifest can add to it, and a `tools:node="remove"` can silently stop applying.
# PRIVACY.md's claim is about the merged set, so the merged set is pinned here,
# exactly, and a new one fails the build rather than shipping unannounced.
set -euo pipefail

apk=$1
expected_code=$2
expected_name=$3

# Every permission Cue's own manifest declares or accepts from a plugin.
#   INTERNET                                 Trakt, declared by hand
#   POST_NOTIFICATIONS                       episode reminders (API 33+ runtime ask)
#   RECEIVE_BOOT_COMPLETED, WAKE_LOCK        the notification plugin's alarm receiver
#   DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION AGP's own, injected for targetSdk >= 33
# SCHEDULE_EXACT_ALARM is absent deliberately: android/app/src/main/AndroidManifest.xml
# removes it, and its absence here is what proves the removal still applies.
expected_permissions="android.permission.INTERNET
android.permission.POST_NOTIFICATIONS
android.permission.RECEIVE_BOOT_COMPLETED
android.permission.WAKE_LOCK
app.cuetracker.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION"

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

echo "verify-apk: $apk is $name ($code), asking for $(wc -l <<<"$permissions" | tr -d ' ') permissions."
