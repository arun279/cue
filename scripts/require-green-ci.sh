#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${SHA:?SHA is required}"
: "${CI_RUN_ID:?CI_RUN_ID is required}"
: "${CODEQL_RUN_ID:?CODEQL_RUN_ID is required}"

required=$(jq -c . "$(dirname "$0")/../.github/required-checks.json")

verify_run() {
  local run_id=$1 workflow=$2 codeql=$3 run jobs attempt status
  run=$(gh api "repos/$REPO/actions/runs/$run_id")
  if ! jq -e --arg sha "$SHA" --arg path ".github/workflows/$workflow.yml" \
    '.head_sha == $sha and .path == $path and .event == "push" and .status == "completed" and .run_attempt >= 1' <<<"$run" > /dev/null; then
    echo "::error::Refusing to ship $SHA: run $run_id must be a completed $workflow push run for this exact commit"
    return 1
  fi
  jobs='[]'
  for ((attempt=1; attempt<=$(jq -r .run_attempt <<<"$run"); attempt++)); do
    status=$(gh api --paginate --slurp "repos/$REPO/actions/runs/$run_id/attempts/$attempt/jobs?per_page=100")
    jobs=$(jq -cn --argjson previous "$jobs" --argjson pages "$status" \
      '$previous + [$pages[].jobs[]]')
  done
  status=$(jq -r --argjson required "$required" --argjson codeql "$codeql" '
    . as $jobs | $required[] | select(startswith("codeql (") == $codeql) | . as $name |
    [$jobs[] | select(.name == $name)] as $attempts |
    if ($attempts | length) == 0 then "\($name): missing"
    else $attempts[] | select(.status != "completed" or .conclusion != "success") |
      "\(.name): attempt \(.run_attempt) \(.conclusion // .status)" end' <<<"$jobs")
  if [ -n "$status" ]; then
    echo "::error::Refusing to ship $SHA from run $run_id:"
    echo "$status"
    return 1
  fi
  echo "Required jobs passed in every attempt of $workflow run $run_id for $SHA"
}

verify_run "$CI_RUN_ID" ci false
verify_run "$CODEQL_RUN_ID" codeql true
