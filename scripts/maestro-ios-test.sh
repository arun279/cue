#!/usr/bin/env bash
set -euo pipefail

debug_output=$1
shift

latest_log() {
  find "$debug_output" -name maestro.log | sort | tail -n 1
}

driver_never_started() {
  local log
  log=$(latest_log)
  grep -qs 'xcTestDriverStatusCheck: \[Failed\]' "$log" && ! grep -qs 'onCommandStart: ' "$log"
}

driver_exited_during_first_launch() {
  local log
  log=$(latest_log)
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
driver_never_started || driver_exited_during_first_launch || exit 1
echo "::warning::The Maestro XCUITest driver failed before the first flow command finished; restarting it once"
exec maestro --device "$DEVICE_ID" test --debug-output "$debug_output" "$@"
