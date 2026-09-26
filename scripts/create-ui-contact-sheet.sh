#!/usr/bin/env bash
set -euo pipefail

output=$1
shift
images=()

while IFS= read -r image; do
  images+=("$image")
done < <(find "$@" -type f -name '*.png' | sort)

test "${#images[@]}" -gt 0
montage -font /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf -label '%t' "${images[@]}" \
  -thumbnail '320x700>' -tile 4x -geometry '+16+32' \
  -background '#111111' -fill '#ffffff' "$output"
