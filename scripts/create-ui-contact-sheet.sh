#!/usr/bin/env bash
set -euo pipefail

directory=$1
platform=$2
appearance=$3
output="$directory/contact-$platform-$appearance.png"
images=()

while IFS= read -r image; do
  images+=("$image")
done < <(find "$directory" -type f -name '*.png' ! -name 'contact-*.png' | sort)

test "${#images[@]}" -gt 0
montage -label '%t' "${images[@]}" -thumbnail '320x700>' -tile 4x -geometry '+16+32' \
  -background '#111111' -fill '#ffffff' "$output"
