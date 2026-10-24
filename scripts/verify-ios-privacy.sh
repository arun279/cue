#!/usr/bin/env bash
# Usage: verify-ios-privacy.sh <Info.plist> <entitlements> [configuration] [local_exception_domain]
set -euo pipefail

info_plist=$1
entitlements=$2
local_exception_domain=${4:-}
plist_buddy=/usr/libexec/PlistBuddy

if [ ! -f "$info_plist" ] || [ ! -f "$entitlements" ]; then
  echo "verify-ios-privacy: generated Info.plist or entitlements file is missing." >&2
  exit 1
fi

if [ "$("$plist_buddy" -c 'Print :NSAppTransportSecurity:NSAllowsArbitraryLoads' "$info_plist")" != "false" ]; then
  echo "verify-ios-privacy: NSAllowsArbitraryLoads must be false." >&2
  exit 1
fi

if [ -z "$local_exception_domain" ]; then
  if "$plist_buddy" -c 'Print :NSAppTransportSecurity:NSExceptionDomains' "$info_plist" >/dev/null 2>&1; then
    echo "verify-ios-privacy: NSExceptionDomains must be absent." >&2
    exit 1
  fi
else
  exceptions=$(plutil -extract NSAppTransportSecurity.NSExceptionDomains json -o - "$info_plist")
  if ! jq -e --arg domain "$local_exception_domain" \
    '. == {($domain): {NSExceptionAllowsInsecureHTTPLoads: true}}' <<< "$exceptions" >/dev/null; then
    echo "verify-ios-privacy: the local transport exception differs from the expected domain." >&2
    exit 1
  fi
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

if [ "$(grep -c '<key>' "$entitlements" || true)" != "0" ]; then
  echo "verify-ios-privacy: generated entitlements differ from the expected baseline." >&2
  exit 1
fi

echo "verify-ios-privacy: transport security, scene lifecycle, Face ID usage, and entitlements are valid."
