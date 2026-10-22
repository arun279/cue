#!/usr/bin/env bash
set -euo pipefail

# Prints "<run-id> <event> <status>" for each CI run of a commit, newest first.
sha=${1:?Usage: scripts/ci-runs.sh <commit-sha>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
gh api graphql -f owner="${repo%/*}" -f name="${repo#*/}" -f sha="$sha" -f query='
  query($owner: String!, $name: String!, $sha: GitObjectID!) {
    repository(owner: $owner, name: $name) {
      object(oid: $sha) {
        ... on Commit {
          checkSuites(first: 100) {
            nodes { status workflowRun { databaseId event workflow { resourcePath } } }
          }
        }
      }
    }
  }' --jq '.data.repository.object.checkSuites.nodes
  | map(select((.workflowRun.workflow.resourcePath // "") | endswith("/actions/workflows/ci.yml")))
  | sort_by(-.workflowRun.databaseId)[]
  | [.workflowRun.databaseId, .workflowRun.event, .status] | @tsv'
