#!/usr/bin/env bash
set -euo pipefail

app=$1
bundle=$2
entitlements=$(mktemp "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/entitlements.XXXXXX")
cp "$bundle/main.hbc" "$app/main.jsbundle"
rsync -a --delete "$bundle/assets/" "$app/assets/"
codesign -d --entitlements :- "$app" > "$entitlements"
codesign -f -s - --entitlements "$entitlements" "$app"
