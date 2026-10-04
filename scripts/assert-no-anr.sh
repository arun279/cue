#!/usr/bin/env bash
set -euo pipefail

if grep -Eq 'reason=6 \(ANR\)|REASON_ANR|ANR in app\.cuetracker' "$@"; then
  echo "ANR detected for app.cuetracker: https://developer.android.com/topic/performance/vitals/anr" >&2
  exit 1
fi

echo "Android ANR count: 0"
