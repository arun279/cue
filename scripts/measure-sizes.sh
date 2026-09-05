#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: scripts/measure-sizes.sh <tree> <out.json>" >&2
  exit 1
fi

head_root=$(git rev-parse --show-toplevel)
tree=$(cd "$1" && pwd)
output_dir=$(cd "$(dirname "$2")" && pwd)
output="$output_dir/$(basename "$2")"
mkdir -p "$tree/node_modules/.tmp"
export TMPDIR="$tree/node_modules/.tmp"

(
  cd "$tree"
  pnpm install --frozen-lockfile
  pnpm --filter @cue/web build
  EXPO_PUBLIC_TRAKT_CLIENT_ID=ci pnpm --filter @cue/native exec expo export \
    --platform ios --platform android --output-dir dist
)

state="$tree/node_modules/.cue-size-measure"
mkdir -p "$state"
cp "$tree/package.json" "$state/package.json"
had_config=0
if [ -f "$tree/.size-limit.json" ]; then
  cp "$tree/.size-limit.json" "$state/.size-limit.json"
  had_config=1
fi

restore() {
  cp "$state/package.json" "$tree/package.json"
  if [ "$had_config" -eq 1 ]; then
    cp "$state/.size-limit.json" "$tree/.size-limit.json"
  else
    rm -f "$tree/.size-limit.json"
  fi
}
trap restore EXIT

if [ "$tree" != "$head_root" ]; then
  cp "$head_root/.size-limit.json" "$tree/.size-limit.json"
fi
node --input-type=module -e '
  import { readFileSync, writeFileSync } from "node:fs";
  const file = process.argv[1];
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  pkg.devDependencies ??= {};
  pkg.devDependencies["@size-limit/file"] ??= "*";
  writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
' "$tree/package.json"

(
  cd "$tree"
  "$head_root/node_modules/.bin/size-limit" --json > "$state/sizes.json"
)
cp "$state/sizes.json" "$output"
