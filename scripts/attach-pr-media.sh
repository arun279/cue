#!/usr/bin/env bash
set -euo pipefail

pr=${1:?Usage: scripts/attach-pr-media.sh <pr-number>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
head_sha() { gh pr view "$pr" -R "$repo" --json headRefOid --jq .headRefOid; }

sha=$(head_sha)
dir=${TMPDIR:-/tmp}
dir=${dir%/}/pr-media-$pr-${sha:0:7}
review=$dir/review.md
if [ ! -f "$review" ]; then
  artifact=$(gh api "repos/$repo/actions/artifacts?name=pr-media-$sha&per_page=100" \
    --jq '[.artifacts[] | select(.expired | not)] | max_by(.created_at) | .id // empty')
  if [ -z "$artifact" ]; then
    echo "No pr-media-$sha artifact yet. Wait for the pr-media job on ${sha:0:7}." >&2
    exit 1
  fi
  mkdir -p "$dir"
  gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$dir/artifact.zip"
  unzip -qo "$dir/artifact.zip" -d "$dir"
  rm "$dir/artifact.zip"
fi

images=$(sed -nE 's/^!\[.*\]\(([^)/]+\.png)\)$/\1/p' "$review")
for image in $images; do echo "$dir/$image"; done
pending=$(grep -c VERDICT_PENDING "$review" || true)
if [ "$pending" -gt 0 ]; then
  echo "Open each image, replace all $pending VERDICT_PENDING placeholders in $review, then run this again." >&2
  exit 1
fi
if [ "$(head_sha)" != "$sha" ]; then
  echo "The pull request moved past ${sha:0:7}. Wait for the pr-media job on its new head." >&2
  exit 1
fi

# gh pr review has no --attach, so upload through the endpoint gh's --attach uses.
repository_id=$(gh api "repos/$repo" --jq .id)
body=$(cat "$review")
for image in $images; do
  url=$(gh api --method POST \
    "https://uploads.github.com/user-attachments/assets?name=$image&content_type=image/png&repository_id=$repository_id" \
    -H 'Content-Type: application/octet-stream' --input "$dir/$image" --jq .url)
  body=${body//"]($image)"/"]($url)"}
done
gh pr review "$pr" -R "$repo" --comment --body "$body"
