#!/usr/bin/env bash
# Usage: diff-footprint.sh <base-ref> [base-metrics.json] [head-metrics.json]
#
# Reports the changed-line footprint against a pull request's merge base.
set -euo pipefail

usage() {
  echo "Usage: scripts/diff-footprint.sh <base-ref> [base-metrics.json] [head-metrics.json]" >&2
  exit 1
}

[ "$#" -eq 1 ] || [ "$#" -eq 3 ] || usage
base_ref=$1
base_metrics=${2:-}
head_metrics=${3:-}
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

if [ -r "$base_metrics" ] && [ -r "$head_metrics" ]; then
  node --input-type=module - "$base_metrics" "$head_metrics" <<'NODE'
import { readFileSync } from "node:fs";

const [basePath, headPath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));
const byName = (entries) => Object.fromEntries(entries.map((entry) => [entry.name, entry]));
const baseSizes = base.sizes === null ? null : byName(base.sizes);
const headSizes = byName(head.sizes);

const bytes = (value) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} MB` : `${(value / 1000).toFixed(1)} kB`;
const deltaBytes = (value) => {
  if (value === 0) return "0 B";
  const sign = value > 0 ? "+" : "-";
  const magnitude = Math.abs(value);
  return magnitude < 1000
    ? `${sign}${magnitude} B`
    : magnitude < 1_000_000
      ? `${sign}${(magnitude / 1000).toFixed(1)} kB`
      : `${sign}${(magnitude / 1_000_000).toFixed(2)} MB`;
};
const signed = (value, digits = 0) =>
  value === 0 ? (digits === 0 ? "0" : value.toFixed(digits)) : `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
const sizeRows = [
  ["web initial load (brotli)", "web initial load"],
  ["web all js and css (brotli)", "web all JavaScript and CSS"],
  ["expo ios bundle (raw)", "expo iOS bundle"],
  ["expo android bundle (raw)", "expo Android bundle"],
];

process.stdout.write("\n### Bundle size\n\n");
process.stdout.write("| bundle | base | head | delta | limit |\n");
process.stdout.write("| --- | ---: | ---: | ---: | ---: |\n");
for (const [label, name] of sizeRows) {
  const before = baseSizes?.[name];
  const after = headSizes[name];
  const baseCell = before === undefined ? "n/a" : bytes(before.size);
  const deltaCell = before === undefined ? "n/a" : deltaBytes(after.size - before.size);
  process.stdout.write(
    `| ${label} | ${baseCell} | ${bytes(after.size)} | ${deltaCell} | ${after.sizeLimit / 1000} kB |\n`,
  );
}

const complexityRows = [
  ["functions over cognitive complexity 15", base.complexity?.over15, head.complexity.over15, 0],
  ["worst cognitive complexity", base.complexity?.max, head.complexity.max, 0],
  [
    "mean cognitive complexity (functions scoring 2 or more)",
    base.complexity?.mean,
    head.complexity.mean,
    2,
  ],
  ["product comment density", base.comments?.total.density, head.comments.total.density, 2],
];
process.stdout.write("\n### Complexity and comments\n\n");
process.stdout.write("| metric | base | head | delta |\n");
process.stdout.write("| --- | ---: | ---: | ---: |\n");
for (const [label, before, after, digits] of complexityRows) {
  const suffix = label === "product comment density" ? " percent" : "";
  const baseCell = before === undefined ? "n/a" : `${before.toFixed(digits)}${suffix}`;
  const deltaCell = before === undefined ? "n/a" : signed(after - before, digits);
  process.stdout.write(
    `| ${label} | ${baseCell} | ${after.toFixed(digits)}${suffix} | ${deltaCell} |\n`,
  );
}

if (base.sizes === null || base.complexity === null || base.comments === null) {
  process.stdout.write(
    "\nThe merge base does not contain the measured packages, so its columns read n/a.\n",
  );
}
NODE
fi
