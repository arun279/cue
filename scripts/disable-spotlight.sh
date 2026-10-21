#!/usr/bin/env bash
set -uo pipefail

# Spotlight is turned off to ease the runner's memory pressure, not because a
# flow depends on it, so a runner that does not confirm it off only warns.
flat() { printf '%s' "$1" | tr '\n\t' '  '; }

off=0
output=$(sudo mdutil -a -i off 2>&1) || off=$?
if [ "$off" -ne 0 ]; then
  echo "::warning title=Spotlight::sudo mdutil -a -i off exited $off: $(flat "$output")"
fi
check=0
status=$(mdutil -s / 2>&1) || check=$?
if [ "$check" -ne 0 ] || ! grep -q "Indexing disabled" <<< "$status"; then
  echo "::warning title=Spotlight::Spotlight indexing is not confirmed off for / (mdutil -s / exited $check): $(flat "$status")"
fi
