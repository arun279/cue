#!/usr/bin/env bash
set -euo pipefail

directory=$1
platform=$2
appearance=$3
output="$directory/contact-$platform-$appearance.png"
images=()
font=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
montage_command=(montage)

if [ "$(uname)" = Darwin ]; then
  font=/System/Library/Fonts/Supplemental/Arial.ttf
fi
if ! command -v montage > /dev/null; then
  montage_command=(magick montage)
fi

while IFS= read -r image; do
  images+=("$image")
done < <(find "$directory" -type f -name '*.png' ! -name 'contact-*.png' | sort)

test "${#images[@]}" -gt 0
"${montage_command[@]}" -font "$font" -label '%t' "${images[@]}" -thumbnail '320x700>' \
  -tile 4x -geometry '+16+32' \
  -background '#111111' -fill '#ffffff' "$output"
