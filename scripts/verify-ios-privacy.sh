#!/usr/bin/env bash
# Usage: verify-ios-privacy.sh <Info.plist> <entitlements>
set -euo pipefail

info_plist=$1
entitlements=$2
plist_buddy=/usr/libexec/PlistBuddy

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
  "$plist_buddy" -c 'Print :UIApplicationSceneManifest:UISceneConfigurations:UIWindowSceneSessionRoleApplication:0:UISceneDelegateClassName' "$info_plist"
)
if [ "$delegate" != '$(PRODUCT_MODULE_NAME).SceneDelegate' ]; then
  echo "verify-ios-privacy: the application scene has no generated SceneDelegate." >&2
  exit 1
fi

if "$plist_buddy" -c 'Print :NSFaceIDUsageDescription' "$info_plist" >/dev/null 2>&1; then
  echo "verify-ios-privacy: NSFaceIDUsageDescription must be absent." >&2
  exit 1
fi

if [ "$(grep -c '<key>' "$entitlements")" != "1" ] ||
  [ "$("$plist_buddy" -c 'Print :aps-environment' "$entitlements")" != "development" ]; then
  echo "verify-ios-privacy: generated entitlements differ from the expected baseline." >&2
  exit 1
fi

echo "verify-ios-privacy: transport security, scene lifecycle, Face ID usage, and entitlements are valid."
