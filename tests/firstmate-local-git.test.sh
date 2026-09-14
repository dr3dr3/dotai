#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/firstmate-local-git.sh
source "$ROOT/scripts/firstmate-local-git.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
workspace="$tmp/local-dev-env"
ai_devex="$workspace/.ai/ai-devex"

mkdir -p "$workspace" "$ai_devex"
git -C "$workspace" init -q
git -C "$workspace" config user.email test@example.com
git -C "$workspace" config user.name Test
printf 'team ignore\n' >"$workspace/.gitignore"
git -C "$workspace" add .gitignore
git -C "$workspace" commit -qm initial

git -C "$ai_devex" init -q
git -C "$ai_devex" config user.email test@example.com
git -C "$ai_devex" config user.name Test
printf 'ai-devex ignore\n' >"$ai_devex/.gitignore"
git -C "$ai_devex" add .gitignore
git -C "$ai_devex" commit -qm initial

if fm_personal_git_excludes_check "$workspace" 2>/dev/null; then
  printf 'preflight unexpectedly accepted visible Firstmate paths\n' >&2
  exit 1
fi

fm_personal_git_excludes_configure "$workspace" "$ai_devex"
fm_personal_git_excludes_configure "$workspace" "$ai_devex"
fm_personal_git_excludes_check "$workspace"

workspace_exclude="$(fm_git_info_exclude_path "$workspace")"
ai_devex_exclude="$(fm_git_info_exclude_path "$ai_devex")"
for pattern in /firstmate/ /.firstmate-home/ /.firstmate-secondmates/; do
  [[ "$(grep -Fxc -- "$pattern" "$workspace_exclude")" == 1 ]]
done
[[ "$(grep -Fxc -- '/.firstmate-home/' "$ai_devex_exclude")" == 1 ]]

mkdir -p \
  "$workspace/firstmate" \
  "$workspace/.firstmate-home" \
  "$workspace/.firstmate-secondmates" \
  "$ai_devex/.firstmate-home"
touch \
  "$workspace/firstmate/runtime" \
  "$workspace/.firstmate-home/private-state" \
  "$workspace/.firstmate-secondmates/private-state" \
  "$ai_devex/.firstmate-home/private-state"

for path in \
  firstmate/runtime \
  .firstmate-home/private-state \
  .firstmate-secondmates/private-state; do
  git -C "$workspace" check-ignore -q -- "$path"
done
git -C "$ai_devex" check-ignore -q -- .firstmate-home/private-state

git -C "$workspace" diff --quiet -- .gitignore
git -C "$ai_devex" diff --quiet -- .gitignore
[[ "$(cat "$workspace/.gitignore")" == 'team ignore' ]]
[[ "$(cat "$ai_devex/.gitignore")" == 'ai-devex ignore' ]]

printf 'firstmate-local Git exclude tests passed\n'
