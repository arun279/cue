#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ] && [ "$#" -ne 2 ]; then
  echo "Usage: scripts/diff-footprint.sh <base-ref> [expo-export-dir]" >&2
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
  ':(glob).maestro/**')
read -r tooling_net _ < <(net_lines \
  ':(glob).github/**' \
  ':(glob)scripts/**')
product_net=$((product_lines - comment_net))

cat <<EOF
<!-- diff-footprint -->
### Pull request footprint

| measurement | base to head |
| --- | ---: |
| Product code lines in core/src, native/src, native/app, and native/modules | $(printf '%+d' "$product_net") |
| Test lines in test, \`packages/*/{test,__tests__}\`, and .maestro | $(printf '%+d' "$test_net") |
| CI and tooling lines in .github and scripts | $(printf '%+d' "$tooling_net") |
| Product comment lines identified by a comment prefix | $(printf '%+d' "$comment_net") |
EOF

if [ "$#" -eq 2 ]; then
  dist=$2
  echo
  echo "| JavaScript bundle at head | size |"
  echo "| --- | ---: |"
  for platform in ios android; do
    set -- "$dist"/_expo/static/js/"$platform"/entry-*.hbc
    echo "| Expo $platform bundle | $(($(wc -c < "$1") / 1000)) kB |"
  done
fi
