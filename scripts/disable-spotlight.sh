#!/usr/bin/env bash
set -euo pipefail

sudo mdutil -a -i off > /dev/null
status=$(mdutil -s /)
if ! grep -q "Indexing disabled" <<< "$status"; then
  echo "Spotlight indexing is still on for /: $status" >&2
  exit 1
fi
