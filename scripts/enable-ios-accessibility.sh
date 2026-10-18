#!/usr/bin/env bash
set -euo pipefail

plist=${1:?Usage: scripts/enable-ios-accessibility.sh <simulator-data-path>}/Library/Preferences/com.apple.Accessibility.plist
mkdir -p "${plist%/*}"
[ -f "$plist" ] || plutil -create binary1 "$plist"
for key in AccessibilityEnabled ApplicationAccessibilityEnabled; do
  plutil -replace "$key" -bool true "$plist"
done
