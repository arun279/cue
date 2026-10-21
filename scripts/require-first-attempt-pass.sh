#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REPOSITORY:?}" "${GITHUB_RUN_ID:?}" "${GITHUB_RUN_ATTEMPT:?}"
jobs=$(jq -cn '$ARGS.positional' --args "$@")
failures=$(mktemp)
# A job GitHub never handed to a runner has no runner_id and no steps; it ran
# nothing, so a rerun of it is a first run rather than a retry.
unfinished='.[].jobs[]
  | select((.name | sub(" \\(.*\\)$"; "")) as $name | $jobs | index($name))
  | select(.conclusion != "success" and .conclusion != "skipped")
  | ((.runner_id // 0) != 0 or ((.steps // []) | length) > 0) as $ran'
for ((attempt = 1; attempt < GITHUB_RUN_ATTEMPT; attempt++)); do
  history=$(gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID/attempts/$attempt/jobs?per_page=100")
  jq -r --argjson jobs "$jobs" "$unfinished"' | select($ran)
    | "\(.name): attempt \(.run_attempt) \(.conclusion // .status)"' <<< "$history" >> "$failures"
  jq -r --argjson jobs "$jobs" "$unfinished"' | select($ran | not)
    | "::notice::\(.name): attempt \(.run_attempt) never reached a runner, so nothing ran"' <<< "$history"
done
if [ -s "$failures" ]; then
  echo "::error::Refusing run $GITHUB_RUN_ID: these jobs passed only on a rerun"
  cat "$failures"
  exit 1
fi
