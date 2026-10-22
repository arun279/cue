#!/usr/bin/env bash
set -euo pipefail

app=$1
appearance=$2
device_id=${DEVICE_ID:?The simulator must be booted before preparation}

xcrun simctl install "$device_id" "$app"
xcrun simctl bootstatus "$device_id" -b
scripts/disable-ios-daemons.sh "$device_id" --booted
scripts/disable-spotlight.sh
xcrun simctl ui "$device_id" content_size medium
xcrun simctl ui "$device_id" appearance "$appearance"
xcrun simctl spawn "$device_id" defaults write com.apple.keyboard.preferences \
  DidShowContinuousPathIntroduction -bool true
# The Android lanes run with animations off; Reduce Motion is the iOS match, so
# no capture lands mid-animation on a slow runner.
xcrun simctl spawn "$device_id" defaults write com.apple.Accessibility ReduceMotionEnabled -bool true
# A fresh simulator asks "Open in Cue?" the first time a cue:// link opens it, and
# remembers the answer. Recording the approval up front means every link a flow
# opens behaves the same, whatever order the flows run in.
xcrun simctl spawn "$device_id" defaults write com.apple.launchservices.schemeapproval \
  'com.apple.CoreSimulator.CoreSimulatorBridge-->cue' -string app.cuetracker
xcrun simctl launch --terminate-running-process "$device_id" app.cuetracker
xcrun simctl terminate "$device_id" app.cuetracker
node scripts/wait-ios-ready.mjs "$device_id"
scripts/snapshot-host-resources.sh "$RUNNER_TEMP/host-resources-prepared.txt"
