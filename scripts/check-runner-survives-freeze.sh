#!/usr/bin/env bash
set -euo pipefail

device_id=${DEVICE_ID:?The simulator must be booted first}
runner="http://127.0.0.1:${MAESTRO_RUNNER_PORT:?}"
log=$1
response=$(mktemp)

backboardd=$(xcrun simctl spawn "$device_id" launchctl list | awk '$3 == "com.apple.backboardd" { print $1 }')
if [[ ! $backboardd =~ ^[0-9]+$ ]]; then
  echo "backboardd is not running on $device_id" >&2
  exit 1
fi

kill -STOP "$backboardd"
status=$(curl -s --max-time 90 -o "$response" -w '%{http_code}' "$runner/screenshot" || true)
kill -CONT "$backboardd"

if [ "$status" != 500 ] || ! grep -q '"errorMessage"' "$response"; then
  echo "A screenshot with backboardd frozen returned $status instead of the runner's XCTest issue:" >&2
  cat "$response" >&2
  exit 1
fi
echo "Screenshot with backboardd frozen: $status $(cat "$response")"
if grep -Ei "test case .*testHttpServer.* (passed|failed)" "$log"; then
  echo "The runner's server test ended during the freeze" >&2
  exit 1
fi
curl -sSf --max-time 60 -X POST "$runner/deviceInfo"
echo
