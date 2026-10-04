#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] && [ "$#" -ne 3 ]; then
  echo "Usage: scripts/diff-footprint.sh <base-ref> [base-metrics.json] [head-metrics.json]" >&2
  exit 1
fi

base=$(git rev-parse --verify --end-of-options "$1^{commit}")

net_lines() {
  git diff --no-renames --unified=0 --no-color "$base"...HEAD -- "$@" | awk '
    function count(line, sign) {
      sub(/^[[:space:]]+/, "", line)
      if (line == "") return
      lines += sign
      if (line ~ /^(\/\/|\/\*|\*)/) comments += sign
    }
    /^diff --git / { in_hunk = 0; next }
    /^@@/ { in_hunk = 1; next }
    in_hunk && /^\+/ { count(substr($0, 2), 1); next }
    in_hunk && /^-/ { count(substr($0, 2), -1) }
    END { printf "%d %d\n", lines, comments }
  '
}

read -r product_lines comment_net < <(net_lines \
  ':(glob)packages/core/src/**' \
  ':(glob)packages/native/src/**' \
  ':(glob)packages/native/app/**' \
  ':(glob)packages/native/modules/**')
read -r test_net _ < <(net_lines \
  ':(glob)test/**' \
  ':(glob)packages/*/test/**' \
  ':(glob)packages/*/__tests__/**' \
  ':(glob)packages/*/e2e/**' \
  ':(glob).maestro/**')
read -r tooling_net _ < <(net_lines \
  ':(glob).github/**' \
  ':(glob)scripts/**' \
  ':(glob)fastlane/**')
product_net=$((product_lines - comment_net))

cat <<EOF
<!-- diff-footprint -->
### Pull request footprint

| measurement | base to head |
| --- | ---: |
| Product code lines in core/src, native/src, native/app, and native/modules | $(printf '%+d' "$product_net") |
| Test lines in test, \`packages/*/{test,__tests__,e2e}\`, and .maestro | $(printf '%+d' "$test_net") |
| CI and tooling lines in .github, scripts, and fastlane | $(printf '%+d' "$tooling_net") |
| Product comment lines identified by a comment prefix | $(printf '%+d' "$comment_net") |
EOF

if [ "$#" -eq 3 ]; then
  node --input-type=module - "$2" "$3" <<'NODE'
import { readFileSync } from "node:fs";

const [basePath, headPath] = process.argv.slice(2);
const base = JSON.parse(readFileSync(basePath, "utf8"));
const head = JSON.parse(readFileSync(headPath, "utf8"));
const byName = (entries) => Object.fromEntries(entries.map((entry) => [entry.name, entry]));
const before = byName(base.sizes ?? []);
const after = byName(head.sizes);
const bytes = (value) =>
  value >= 1_000_000 ? `${(value / 1_000_000).toFixed(2)} MB` : `${(value / 1000).toFixed(1)} kB`;
const delta = (value) => (value === 0 ? "0 B" : `${value > 0 ? "+" : ""}${bytes(value)}`);
const rows = [
  ["Expo iOS JavaScript bundle, raw file", "expo iOS bundle"],
  ["Expo Android JavaScript bundle, raw file", "expo Android bundle"],
  ["Firebase tester APK, arm64-v8a and all densities", "Firebase tester APK file"],
  ["Play download estimate, XXXHDPI arm64-v8a English Android 15", "Play download estimate"],
];

process.stdout.write("\n### User-delivered artifact sizes\n\n");
process.stdout.write("| measurement | base | head | delta |\n");
process.stdout.write("| --- | ---: | ---: | ---: |\n");
for (const [label, name] of rows) {
  const baseEntry = before[name];
  const headEntry = after[name];
  if (headEntry === undefined) throw new Error(`${name}: missing head measurement`);
  const baseCell = baseEntry === undefined ? "missing" : bytes(baseEntry.size);
  const deltaCell = baseEntry === undefined ? "missing" : delta(headEntry.size - baseEntry.size);
  process.stdout.write(`| ${label} | ${baseCell} | ${bytes(headEntry.size)} | ${deltaCell} |\n`);
}
NODE
fi

if [ "$product_net" -gt 0 ] && ! grep -Eq '^Product-Growth: .+' <<<"${PR_BODY:-}"; then
  echo 'Product code grew. Add "Product-Growth: <rationale>" to the PR body.' >&2
  exit 1
fi
if [ "$comment_net" -gt 0 ] && ! grep -Eq '^Comment-Load: .+' <<<"${PR_BODY:-}"; then
  echo 'Product comments grew. Add "Comment-Load: <rationale>" to the PR body.' >&2
  exit 1
fi
