#!/usr/bin/env bash
set -euo pipefail

bundle=$1
output=$2
case $(uname -s) in
  Darwin) platform=osx-bin ;;
  *) platform=linux64-bin ;;
esac
hermesc="$(cd "$(dirname "$0")/.." && pwd)/node_modules/hermes-compiler/hermesc/$platform/hermesc"
cd "$(dirname "$bundle")"
"$hermesc" -emit-binary -O -w -out "$output" "$(basename "$bundle")"
