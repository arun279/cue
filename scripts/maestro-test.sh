#!/usr/bin/env bash
set -euo pipefail

status=0
maestro "$@" || status=$?
if [ "$status" -ne 0 ]; then
  printf 'Maestro failed (exit %s). Command:' "$status"
  printf ' %q' maestro "$@"
  printf '\n'
  node "$(dirname "$0")/maestro-failure.mjs" "$@" || true
fi
exit "$status"
