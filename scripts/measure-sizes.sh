#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: scripts/measure-sizes.sh <native-directory> <out.json>" >&2
  exit 1
fi

native=$1
output=$2
set -- "$native"/dist/_expo/static/js/ios/entry-*.hbc
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Expected one Expo iOS bundle" >&2; exit 1; }
ios=$(wc -c < "$1" | tr -d ' ')
set -- "$native"/dist/_expo/static/js/android/entry-*.hbc
[ "$#" -eq 1 ] && [ -f "$1" ] || { echo "Expected one Expo Android bundle" >&2; exit 1; }
android=$(wc -c < "$1" | tr -d ' ')
jq -n --argjson ios "$ios" --argjson android "$android" '[
  {name: "expo iOS bundle", size: $ios},
  {name: "expo Android bundle", size: $android}
]' > "$output"
