#!/usr/bin/env bash
set -euo pipefail

usage='Usage: scripts/gather-pr-media.sh <pr-number> <run-id> <out-dir>'
pr=${1:?$usage}
run=${2:?$usage}
out=${3:?$usage}
repo=${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
t=$'\t'
lower() { tr '[:upper:]' '[:lower:]' <<< "$1"; }

captures=()
for platform in iOS Android; do
  for appearance in light dark; do
    captures+=("contact-$(lower "$platform")-$appearance${t}Every screen${t}default text${t}$platform${t}$appearance")
  done
done
for size in "xxxl:XXXL text" "ax5:largest text (AX5)"; do
  for page in Library Profile Search; do
    captures+=("$(lower "$page")-${size%%:*}${t}$page${t}${size#*:}${t}iOS${t}dark")
  done
done

collect() {
  mkdir -p "$work/$1" "$out"
  for artifact in $(gh api "repos/$repo/actions/runs/$1/artifacts?per_page=100" \
    --jq '.artifacts[] | select(.expired | not) | select(.name == "ui-contact-sheets" or .name == "ui-screenshots-ios-dark") | .id'); do
    gh api "repos/$repo/actions/artifacts/$artifact/zip" > "$work/artifact.zip"
    unzip -qo "$work/artifact.zip" -d "$work/$1"
  done
  found=1
  for capture in "${captures[@]}"; do
    file=$(find "$work/$1" -name "${capture%%"$t"*}.png" -print -quit)
    if [ -n "$file" ]; then
      cp "$file" "$out/"
      found=0
    fi
  done
  return "$found"
}

run_link() { echo "[run $1](https://github.com/$repo/actions/runs/$1)"; }

source="$(run_link "$run") on this commit"
if ! collect "$run"; then
  base=$(gh pr view "$pr" -R "$repo" --json baseRefName --jq .baseRefName)
  source="nothing captured by $(run_link "$run") on this commit or on \`$base\`"
  for base_run in $(gh api "repos/$repo/actions/workflows/ci.yml/runs?branch=$base&event=push&status=completed&per_page=20" --jq '.workflow_runs[].id'); do
    if collect "$base_run"; then
      base_sha=$(gh api "repos/$repo/actions/runs/$base_run" --jq .head_sha)
      source="the newest captures from \`$base\` at ${base_sha:0:7}, $(run_link "$base_run"), which do not include this pull request's changes"
      break
    fi
  done
fi

{
  printf 'file\tscreen\tstate\tplatform\tappearance\tsource\n'
  for capture in "${captures[@]}"; do
    name=${capture%%"$t"*}
    file=-
    if [ -f "$out/$name.png" ]; then file=$name.png; fi
    printf '%s\t%s\t%s\n' "$file" "${capture#*"$t"}" "$source"
  done
} > "$out/captions.tsv"
