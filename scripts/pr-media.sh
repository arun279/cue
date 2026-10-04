#!/usr/bin/env bash
set -euo pipefail

pr=${1:?Usage: scripts/pr-media.sh <pr-number> <run-id>}
run=${2:?Usage: scripts/pr-media.sh <pr-number> <run-id>}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
marker='<!-- pr-media -->'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

names=(contact-ios-light contact-ios-dark contact-android-light contact-android-dark)
captions=("Every iOS screen, light" "Every iOS screen, dark" "Every Android screen, light" "Every Android screen, dark")
for size in "xxxl:XXXL text" "ax5:largest text (AX5)"; do
  for page in Library Profile Search; do
    names+=("$(tr '[:upper:]' '[:lower:]' <<< "$page")-${size%%:*}")
    captions+=("$page, dark, ${size#*:}")
  done
done

collect() {
  mkdir -p "$work/$1" "$work/files"
  for artifact in $(gh api "repos/$repo/actions/runs/$1/artifacts?per_page=100" \
    --jq '.artifacts[] | select(.expired | not) | select(.name == "ui-contact-sheets" or .name == "ui-screenshots-ios-dark") | .id'); do
    gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$work/artifact.zip"
    unzip -qo "$work/artifact.zip" -d "$work/$1"
  done
  missing=()
  for index in "${!names[@]}"; do
    file=$(find "$work/$1" -name "${names[$index]}.png" -print -quit)
    if [ -n "$file" ]; then
      cp "$file" "$work/files/${names[$index]}.png"
    else
      missing+=("${captions[$index]}")
    fi
  done
  [ "${#missing[@]}" -lt "${#names[@]}" ]
}

run_link() { echo "[run $1](https://github.com/$repo/actions/runs/$1)"; }

head_sha=$(gh api "repos/$repo/actions/runs/$run" --jq .head_sha)
note="Captured by $(run_link "$run") on this commit."
if ! collect "$run"; then
  base=$(gh pr view "$pr" -R "$repo" --json baseRefName --jq .baseRefName)
  note="No new captures: $(run_link "$run") captured no screenshots for this commit, and none exist on \`$base\` either."
  for base_run in $(gh api "repos/$repo/actions/workflows/ci.yml/runs?branch=$base&event=push&status=completed&per_page=20" --jq '.workflow_runs[].id'); do
    if collect "$base_run"; then
      base_sha=$(gh api "repos/$repo/actions/runs/$base_run" --jq .head_sha)
      note="No new captures: $(run_link "$run") captured no screenshots for this commit. These are the newest from \`$base\` at ${base_sha:0:7}, $(run_link "$base_run"), and do not include this pull request's changes."
      break
    fi
  done
fi

present() { [ -f "$work/files/${names[$1]}.png" ]; }
image() { echo "![${captions[$1]}](files/${names[$1]}.png)"; }

{
  echo "$marker"
  echo "### UI media for ${head_sha:0:7}"
  echo
  echo "$note"
  if [ "${#missing[@]}" -gt 0 ] && [ "${#missing[@]}" -lt "${#names[@]}" ]; then
    echo
    echo "Missing from that run:"
    printf -- '- %s\n' "${missing[@]}"
  fi
  for index in 0 1 2 3; do
    if present "$index"; then
      printf '\n**%s**\n\n%s\n' "${captions[$index]}" "$(image "$index")"
    fi
  done
  for first in 4 7; do
    header="|" divider="|" cells="|"
    for index in "$first" $((first + 1)) $((first + 2)); do
      header+=" ${captions[$index]} |"
      divider+=" --- |"
      cells+=" $(if present "$index"; then image "$index"; else echo "Missing"; fi) |"
    done
    if [[ $cells == *"!["* ]]; then
      printf '\n%s\n%s\n%s\n' "$header" "$divider" "$cells"
    fi
  done
} > "$work/body.md"

attachments=()
for index in "${!names[@]}"; do
  if present "$index"; then
    attachments+=(--attach "files/${names[$index]}.png")
  fi
done

previous=$(gh api --paginate "repos/$repo/issues/$pr/comments" --jq ".[] | select(.body | startswith(\"$marker\")) | .id")
(cd "$work" && gh pr comment "$pr" -R "$repo" --body-file body.md ${attachments[@]+"${attachments[@]}"})
for id in $previous; do
  gh api --method DELETE "repos/$repo/issues/comments/$id"
done
