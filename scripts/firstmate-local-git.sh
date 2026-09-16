#!/usr/bin/env bash
# Keep personal Firstmate state out of the enclosing team repositories.

fm_git_info_exclude_path() {
  local repo="$1"
  git -C "$repo" rev-parse --path-format=absolute --git-path info/exclude
}

fm_git_exclude_add() {
  local repo="$1" pattern="$2" exclude
  exclude="$(fm_git_info_exclude_path "$repo")" || return 1
  mkdir -p "$(dirname "$exclude")"
  touch "$exclude"
  if ! grep -Fqx -- "$pattern" "$exclude"; then
    printf '%s\n' "$pattern" >>"$exclude"
  fi
}

fm_personal_git_excludes_configure() {
  local workspace="$1" ai_devex="${2:-$1/.ai/ai-devex}" pattern

  git -C "$workspace" rev-parse --show-toplevel >/dev/null 2>&1 || {
    printf 'Firstmate workspace is not a Git checkout: %s\n' "$workspace" >&2
    return 1
  }
  for pattern in /firstmate/ /.firstmate-home/ /.firstmate-secondmates/; do
    fm_git_exclude_add "$workspace" "$pattern" || return 1
  done

  if git -C "$ai_devex" rev-parse --show-toplevel >/dev/null 2>&1; then
    fm_git_exclude_add "$ai_devex" /.firstmate-home/ || return 1
  fi
}

fm_personal_git_excludes_check() {
  local workspace="$1" path

  git -C "$workspace" rev-parse --show-toplevel >/dev/null 2>&1 || {
    printf 'Firstmate workspace is not a Git checkout: %s\n' "$workspace" >&2
    return 1
  }
  for path in firstmate/.firstmate-ignore-probe \
    .firstmate-home/.firstmate-ignore-probe \
    .firstmate-secondmates/.firstmate-ignore-probe; do
    if ! git -C "$workspace" check-ignore -q -- "$path"; then
      printf 'Personal Firstmate path is not locally ignored: %s/%s\n' \
        "$workspace" "${path%/.firstmate-ignore-probe}" >&2
      return 1
    fi
  done
}
