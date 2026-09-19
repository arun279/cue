#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: scripts/measure-sizes.sh <out.json>" >&2
  exit 1
fi

output=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
temp=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/size-limit.XXXXXX")
trap 'rm -rf "$temp"' EXIT
config="$temp/config.json"
jq --arg root "$PWD/" \
  'map(select(.path) | .path |= if type == "array" then map($root + .) else $root + . end)' \
  .size-limit.json > "$config"
pnpm exec size-limit --config "$config" --json > "$output"
