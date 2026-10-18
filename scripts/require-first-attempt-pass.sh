#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REPOSITORY:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
jobs=$(jq -cn '$ARGS.positional' --args "$@")
failures=$(mktemp)
for ((attempt = 1; attempt < GITHUB_RUN_ATTEMPT; attempt++)); do
  gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$attempt/jobs?per_page=100" |
    jq -r --argjson jobs "$jobs" '.[].jobs[]
      | select((.name | sub(" \\(.*\\)$"; "")) as $name | $jobs | index($name))
      | select(.conclusion != "success" and .conclusion != "skipped")
      | "\(.name): attempt \(.run_attempt) \(.conclusion // .status)"' >> "$failures"
done
if [ -s "$failures" ]; then
  echo "::error::Refusing run $GITHUB_RUN_ID: these jobs passed only on a rerun"
  cat "$failures"
  exit 1
fi
