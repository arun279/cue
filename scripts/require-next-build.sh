#!/usr/bin/env bash
# Usage: require-next-build.sh <ios|android> <highest-shipped-build> <where>
#
# Run from packages/native before `eas build`. EAS numbers the next build one
# above its remote counter, or one above the app config's number when it has no
# counter yet. Stores refuse a number they already have, and Android refuses to
# install a lower one over a higher one.
set -euo pipefail

platform=$1
shipped=$2
where=$3
if ! [[ "$shipped" =~ ^[0-9]+$ ]]; then
  echo "require-next-build: could not read the highest $where build number (got '$shipped')." >&2
  exit 1
fi

field=$([ "$platform" = ios ] && echo buildNumber || echo versionCode)
remote=$(eas build:version:get --non-interactive --json --platform "$platform" --profile production |
  jq -r --arg field "$field" '.[$field] // empty')
seed=$(pnpm exec expo config --type public --json | jq -r --arg p "$platform" --arg field "$field" '.[$p][$field]')
next=$((${remote:-$seed} + 1))

if [ "$next" -le "$shipped" ]; then
  echo "require-next-build: EAS would number this $platform build $next, but $where already has $shipped. Run eas build:version:set to move the counter above $shipped." >&2
  exit 1
fi
echo "require-next-build: $platform build $next is above $where's $shipped."
