#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: scripts/audit-dependencies.sh <event-name> [push-before-sha]" >&2
  exit 1
fi

here=$(dirname "$0")
status=0
pnpm audit --prod --audit-level=high || status=$?
if [ "$status" -ne 0 ] &&
  git diff --quiet "$("$here/measured-base.sh" "$@")" HEAD -- pnpm-lock.yaml pnpm-workspace.yaml; then
  echo "::warning::The audit fails on dependencies this change leaves alone; the nightly audit reports it."
  status=0
fi
exit "$status"
