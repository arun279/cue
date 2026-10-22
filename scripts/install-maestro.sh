#!/usr/bin/env bash
set -euo pipefail

version=2.10.0
sha256=29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991
if [ "${1:-}" = pin ]; then
  echo "$version-$sha256"
  exit
fi
if [ ! -d "$RUNNER_TEMP/maestro" ]; then
  curl -fsSL "https://github.com/mobile-dev-inc/Maestro/releases/download/cli-$version/maestro.zip" \
    -o "$RUNNER_TEMP/maestro.zip"
  echo "$sha256  $RUNNER_TEMP/maestro.zip" | shasum -a 256 -c -
  unzip -q "$RUNNER_TEMP/maestro.zip" -d "$RUNNER_TEMP"
fi
echo "$RUNNER_TEMP/maestro/bin" >> "$GITHUB_PATH"
