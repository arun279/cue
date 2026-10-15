#!/usr/bin/env bash
set -euo pipefail

status=0
node "$(dirname "$0")/maestro-supervisor.mjs" "$@" || status=$?
if [ "$status" -ne 0 ]; then
  printf 'Maestro failed (exit %s). Command:' "$status"
  printf ' %q' maestro --verbose "$@"
  printf '\n'
  node "$(dirname "$0")/maestro-failure.mjs" "$@" || true
fi
exit "$status"
