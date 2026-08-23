#!/usr/bin/env bash
# Usage: diff-footprint.sh <base-ref>
#
# Reports the changed-line footprint against a pull request's merge base.
set -euo pipefail

usage() {
  echo "Usage: scripts/diff-footprint.sh <base-ref>" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
base_ref=$1
base_commit=$(git rev-parse --verify --end-of-options "${base_ref}^{commit}" 2>/dev/null) || usage

git diff --no-renames --numstat "$base_commit"...HEAD | awk '
  BEGIN { FS = "\t" }
  function area(path) {
    if (path ~ /^packages\/[^\/]+\/src\//) return "product"
    if (path ~ /^packages\/[^\/]+\/(test|__tests__)\//) return "tests"
    if (path ~ /^packages\/[^\/]+\/e2e\//) return "e2e"
    return "other"
  }
  {
    added = $1 == "-" ? 0 : $1
    removed = $2 == "-" ? 0 : $2
    bucket = area($3)
    adds[bucket] += added
    removes[bucket] += removed
    total_added += added
    total_removed += removed
  }
  function row(label, bucket, added, removed) {
    added = adds[bucket] + 0
    removed = removes[bucket] + 0
    printf "| %s | %d | %d | %+d |\n", label, added, removed, added - removed
  }
  END {
    print "<!-- diff-footprint -->"
    print "### Diff footprint"
    print ""
    print "| area | added | removed | net |"
    print "| --- | ---: | ---: | ---: |"
    row("product (packages/*/src/)", "product")
    row("tests (packages/*/test/)", "tests")
    row("e2e (packages/*/e2e/)", "e2e")
    row("other", "other")
    printf "| total | %d | %d | %+d |\n", total_added, total_removed, total_added - total_removed
    print ""
  }
'

git diff --no-renames --unified=0 --no-color "$base_commit"...HEAD -- ':(glob)packages/*/src/**' | awk '
  function classify(line, direction) {
    sub(/^[[:space:]]+/, "", line)
    if (line == "") kind = "blank"
    else if (line ~ /^(\/\/|\/\*|\*)/) kind = "comments"
    else kind = "code"
    counts[kind, direction]++
  }
  /^diff --git / { in_hunk = 0; next }
  /^@@/ { in_hunk = 1; next }
  in_hunk && /^\+/ { classify(substr($0, 2), "added"); next }
  in_hunk && /^-/ { classify(substr($0, 2), "removed") }
  END {
    net = counts["code", "added"] - counts["code", "removed"]
    printf "Product lines: code +%d / -%d (net %+d), comments +%d / -%d, blank +%d / -%d\n", \
      counts["code", "added"], counts["code", "removed"], net, \
      counts["comments", "added"], counts["comments", "removed"], \
      counts["blank", "added"], counts["blank", "removed"]
    print "Line types are split by line prefix after leading whitespace."
  }
'
