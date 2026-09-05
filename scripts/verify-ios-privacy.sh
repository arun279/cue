#!/usr/bin/env bash
# Usage: verify-ios-privacy.sh <Info.plist> <entitlements> [configuration]
#
# `configuration` is the Xcode build configuration the generated project is
# about to be built in, `Debug` (the default) or `Release`, and it is stated by
# the caller rather than read from the environment so a lane that prebuilds for
# one and builds the other fails here instead of shipping.
set -euo pipefail

info_plist=$1
entitlements=$2
configuration=${3:-Debug}
plist_buddy=/usr/libexec/PlistBuddy

# expo-notifications writes this from its `mode` prop, which app.config.ts takes
# from the same configuration. Apple then resolves the shipped value from the
# provisioning profile at signing time, so what is pinned here is the generated
# project's own claim.
if [ "$configuration" = "Release" ]; then
  aps_environment=production
else
  aps_environment=development
fi

if [ ! -f "$info_plist" ] || [ ! -f "$entitlements" ]; then
  echo "verify-ios-privacy: generated Info.plist or entitlements file is missing." >&2
  exit 1
fi

if [ "$("$plist_buddy" -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$info_plist")" != "false" ]; then
  echo "verify-ios-privacy: NSAllowsArbitraryLoads must be false." >&2
  exit 1
fi

if "$plist_buddy" -c 'Print :NSAppTransportSecurity:NSExceptionDomains' "$info_plist" >/dev/null 2>&1; then
  echo "verify-ios-privacy: NSExceptionDomains must be absent." >&2
  exit 1
fi

delegate=$(
  "$plist_buddy" -c 'Print :UIApplicationSceneManifest:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0:UISceneDelegateClassName' "$info_plist" 2>/dev/null
) || delegate=""
if [ "$delegate" != '$(PRODUCT_MODULE_NAME).SceneDelegate' ]; then
  echo "verify-ios-privacy: the application scene has no generated SceneDelegate." >&2
  exit 1
fi

if "$plist_buddy" -c 'Print :NSFaceIDUsageDescription' "$info_plist" >/dev/null 2>&1; then
  echo "verify-ios-privacy: NSFaceIDUsageDescription must be absent." >&2
  exit 1
fi

if [ "$(grep -c '<key>' "$entitlements")" != "1" ] ||
  [ "$("$plist_buddy" -c 'Print :aps-environment' "$entitlements")" != "$aps_environment" ]; then
  echo "verify-ios-privacy: generated entitlements differ from the expected baseline." >&2
  exit 1
fi

echo "verify-ios-privacy: transport security, scene lifecycle, Face ID usage, and entitlements are valid."
