#!/usr/bin/env bash
set -euo pipefail

pr=${1:?Usage: scripts/attach-pr-media.sh <pr-number>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
marker='<!-- pr-media -->'

sha=$(gh pr view "$pr" -R "$repo" --json headRefOid --jq .headRefOid)
artifact=$(gh api "repos/$repo/actions/artifacts?name=pr-media-$sha&per_page=100" \
  --jq '[.artifacts[] | select(.expired | not)] | max_by(.created_at) | .id // empty')
if [ -z "$artifact" ]; then
  echo "No pr-media-$sha artifact yet. Wait for the pr-media job on ${sha:0:7}." >&2
  exit 1
fi

dir=${TMPDIR:-/tmp}
dir=${dir%/}/pr-media-$pr-${sha:0:7}
rm -rf "$dir"
mkdir -p "$dir"
gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$dir/artifact.zip"
unzip -qo "$dir/artifact.zip" -d "$dir"
rm "$dir/artifact.zip"

paths=$(awk -F '\t' -v marker="$marker" -v sha="${sha:0:7}" -v dir="$dir" -v body="$dir/body.md" '
  function caption(i) { return screen[i] ", " group[i] }
  NR == 1 { next }
  NR == 2 { source = $6 }
  $1 == "-" { missing = missing "\n- " $2 ", " $4 ", " $5 ", " $3; next }
  { n++; file[n] = $1; screen[n] = $2; group[n] = $4 ", " $5 ", " $3 }
  END {
    printf "%s\n### UI media for %s\n\nSource: %s.\n", marker, sha, source > body
    if (n && missing) printf "\nMissing:%s\n", missing > body
    for (i = 1; i <= n; i = j) {
      for (j = i + 1; j <= n && group[j] == group[i]; j++);
      if (j - i == 1) {
        printf "\n**%s**\n\n![%s](%s)\n", caption(i), caption(i), file[i] > body
        continue
      }
      header = "|"; divider = "|"; cells = "|"
      for (k = i; k < j; k++) {
        header = header " " screen[k] " |"
        divider = divider " --- |"
        cells = cells " ![" caption(k) "](" file[k] ") |"
      }
      printf "\n**%s**\n\n%s\n%s\n%s\n", group[i], header, divider, cells > body
    }
    for (i = 1; i <= n; i++) print dir "/" file[i] "  " caption(i)
  }
' "$dir/captions.tsv")

attachments=()
while read -r file; do
  attachments+=(--attach "$file")
done < <(awk -F '\t' 'NR > 1 && $1 != "-" { print $1 }' "$dir/captions.tsv")

previous=$(gh api --paginate "repos/$repo/issues/$pr/comments" --jq ".[] | select(.body | startswith(\"$marker\")) | .id")
(cd "$dir" && gh pr comment "$pr" -R "$repo" --body-file body.md ${attachments[@]+"${attachments[@]}"})
for id in $previous; do
  gh api --method DELETE "repos/$repo/issues/comments/$id"
done

echo "Open each image before merging:"
echo "${paths:-No images. Read $dir/body.md for what is missing.}"
