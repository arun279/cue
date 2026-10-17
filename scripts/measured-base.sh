#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo "Usage: scripts/measured-base.sh <event-name> [push-before-sha]" >&2
  exit 1
fi

before=${2:-}
if [ "$1" != pull_request ] && [ -n "$before" ] && [ "$before" != 0000000000000000000000000000000000000000 ]; then
  echo "$before"
else
  git rev-parse --verify HEAD^
fi
