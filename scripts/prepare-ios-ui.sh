#!/usr/bin/env bash
set -euo pipefail

app_dir=$1
device_id=$(xcrun simctl list devices available -j | \
  jq -r '[.devices[] | .[] | select(.name | startswith("iPhone"))][0].udid')
test -n "$device_id"
xcrun simctl boot "$device_id"

maestro_zip="$RUNNER_TEMP/maestro.zip"
node scripts/mock-trakt/server.mjs > "$RUNNER_TEMP/mock-trakt.log" 2>&1 &
curl -fsSL \
  https://github.com/mobile-dev-inc/Maestro/releases/download/cli-2.10.0/maestro.zip \
  -o "$maestro_zip" &
maestro_pid=$!
wait "$maestro_pid"

echo "29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991  $maestro_zip" \
  | shasum -a 256 -c -
unzip -q "$maestro_zip" -d "$RUNNER_TEMP"
echo "$RUNNER_TEMP/maestro/bin" >> "$GITHUB_PATH"
tar -xzf "$app_dir/Cue.app.tgz" -C "$app_dir"
xcrun simctl bootstatus "$device_id" -b
xcrun simctl install "$device_id" "$app_dir/Cue.app"

for _ in {1..30}; do
  if curl -fsS http://127.0.0.1:8787/users/settings > /dev/null; then
    echo "device_id=$device_id" >> "$GITHUB_OUTPUT"
    exit 0
  fi
  sleep 1
done
exit 1
