#!/usr/bin/env bash
set -euo pipefail

app_dir=$1
appearance=$2
device_id=${DEVICE_ID:?The simulator must be booted before preparation}

if [ ! -d "$RUNNER_TEMP/maestro" ]; then
  maestro_zip="$RUNNER_TEMP/maestro.zip"
  curl -fsSL \
    https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.10.0/maestro.zip \
    -o "$maestro_zip"

  echo "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991  $maestro_zip" \
    | shasum -a 256 -c -
  unzip -q "$maestro_zip" -d "$RUNNER_TEMP"
fi
echo "$RUNNER_TEMP/maestro/bin" >> "$GITHUB_PATH"
tar -xzf "$app_dir/Cue.app.tgz" -C "$app_dir"
xcrun simctl install "$device_id" "$app_dir/Cue.app"
xcrun simctl bootstatus "$device_id" -b
xcrun simctl ui "$device_id" content_size medium
xcrun simctl ui "$device_id" appearance "$appearance"
xcrun simctl spawn "$device_id" defaults write com.apple.keyboard.preferences \
  DidShowContinuousPathIntroduction -bool true
# The Android lanes run with animations off; Reduce Motion is the iOS match, so
# no capture lands mid-animation on a slow runner.
xcrun simctl spawn "$device_id" defaults write com.apple.Accessibility ReduceMotionEnabled -bool true
xcrun simctl launch --terminate-running-process "$device_id" app.cuetracker
xcrun simctl terminate "$device_id" app.cuetracker
node scripts/wait-ios-ready.mjs "$device_id"
