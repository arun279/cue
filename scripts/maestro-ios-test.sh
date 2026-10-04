#!/usr/bin/env bash
set -euo pipefail

debug_output=$1
shift

driver_exited_during_first_launch() {
  local log
  log=$(find "$debug_output" -name maestro.log | sort | tail -n 1)
  grep -qs 'Transport unreachable while processing' "$log" &&
    awk '
      /onCommandStart: / && !/onCommandStart: (Define variables|Apply configuration|Run )/ {
        if (++started > 1 || !/onCommandStart: Launch app/) exit 1
      }
    ' "$log"
}

if maestro --device "$DEVICE_ID" test --debug-output "$debug_output" "$@"; then
  exit 0
fi
driver_exited_during_first_launch || exit 1
echo "::warning::The Maestro XCUITest driver exited during the first launch; restarting it once"
exec maestro --device "$DEVICE_ID" test --debug-output "$debug_output" "$@"
