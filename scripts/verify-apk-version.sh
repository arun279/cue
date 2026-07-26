#!/usr/bin/env bash
# Usage: verify-apk-version.sh <apk> <expected-version-code> <expected-version-name>
#
# Reads the version out of the packaged APK. AGP's output-metadata.json is the
# build's own account of the variant it configured, so it agrees with a build
# that resolved the version wrong; the APK is what testers install.
set -euo pipefail

apk=$1
expected_code=$2
expected_name=$3

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
aapt2=$(printf '%s\n' "$sdk/build-tools"/*/aapt2 | sort -V | tail -n 1)
if [ ! -x "$aapt2" ]; then
  echo "verify-apk-version: no aapt2 under '$sdk/build-tools'; set ANDROID_HOME or ANDROID_SDK_ROOT to an SDK with build-tools installed." >&2
  exit 1
fi

badging=$("$aapt2" dump badging "$apk")
package_line=${badging%%$'\n'*}
attribute() { sed -n "s/.*$1='\([^']*\)'.*/\1/p" <<<"$package_line"; }
code=$(attribute versionCode)
name=$(attribute versionName)

if [ "$code" != "$expected_code" ] || [ "$name" != "$expected_name" ]; then
  echo "verify-apk-version: $apk is $name ($code), expected $expected_name ($expected_code)." >&2
  exit 1
fi

echo "verify-apk-version: $apk is $name ($code)."
