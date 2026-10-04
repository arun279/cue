#!/usr/bin/env bash

set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${REPO:?REPO is required}"
: "${SHA:?SHA is required}"
: "${REQUIRED:?REQUIRED is required}"
: "${APP_ID:?APP_ID is required}"
: "${DEADLINE_MINUTES:?DEADLINE_MINUTES is required}"
: "${POLL_SECONDS:?POLL_SECONDS is required}"

deadline=$(( $(date +%s) + DEADLINE_MINUTES * 60 ))
ci_run_errors=0
check_runs_errors=0

while :; do
  if ! ci_run=$(gh api \
    "repos/$REPO/actions/workflows/ci.yml/runs?head_sha=$SHA&event=push&per_page=1" \
    --jq '.workflow_runs[0].check_suite_id // empty'); then
    ci_run_errors=$((ci_run_errors + 1))
    if [ "$ci_run_errors" -ge 3 ]; then
      echo "::error::Refusing to ship $SHA: gh api failed 3 times in a row querying ci.yml workflow runs, giving up rather than waiting out the full deadline"
      exit 1
    fi
    echo "Transient error finding ci.yml check suite, retrying"
    sleep "$POLL_SECONDS"
    continue
  fi
  ci_run_errors=0

  if [ -z "$ci_run" ]; then
    status=$(jq -cn --argjson required "$REQUIRED" '
      [ $required[] | { name: ., state: "missing", verdict: "pending" } ]')
  else
    if ! raw=$(gh api --paginate --slurp \
      "repos/$REPO/commits/$SHA/check-runs?filter=all&app_id=$APP_ID&per_page=100"); then
      check_runs_errors=$((check_runs_errors + 1))
      if [ "$check_runs_errors" -ge 3 ]; then
        echo "::error::Refusing to ship $SHA: gh api failed 3 times in a row querying check runs, giving up rather than waiting out the full deadline"
        exit 1
      fi
      echo "Transient error fetching check-runs, retrying"
      sleep "$POLL_SECONDS"
      continue
    fi
    check_runs_errors=0

    status=$(jq -c --argjson app "$APP_ID" --argjson suite "$ci_run" --argjson required "$REQUIRED" '
        [ .[].check_runs[] | select(.app.id == $app) ] as $all_runs
        | [ $required[]
            | . as $name
            | ([ $all_runs[]
                 | select(.name == $name and (($name | startswith("codeql (")) or .check_suite.id == $suite))
               ] | sort_by(.started_at) | last) as $latest
            | if $latest == null then { name: $name, state: "missing", verdict: "pending" }
              elif $latest.status != "completed" then { name: $name, state: $latest.status, verdict: "pending" }
              elif $latest.conclusion == "success" then { name: $name, state: "success", verdict: "ok" }
              else { name: $name, state: ($latest.conclusion // "unknown"), verdict: "failed" }
              end ]' <<<"$raw")
  fi

  failed=$(jq -r '[ .[] | select(.verdict == "failed") | "\(.name) (\(.state))" ] | join(", ")' <<<"$status")
  if [ -n "$failed" ]; then
    echo "::error::Refusing to ship $SHA: required CI checks did not pass: $failed"
    exit 1
  fi

  pending=$(jq -r '[ .[] | select(.verdict == "pending") | "\(.name) (\(.state))" ] | join(", ")' <<<"$status")
  if [ -z "$pending" ]; then
    jq -r '.[] | "  \(.state)  \(.name)"' <<<"$status"
    echo "All required CI checks passed for $SHA."
    exit 0
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    echo "::error::Refusing to ship $SHA: required CI checks never reported within ${DEADLINE_MINUTES}m: $pending"
    exit 1
  fi

  echo "Waiting on $pending"
  sleep "$POLL_SECONDS"
done
