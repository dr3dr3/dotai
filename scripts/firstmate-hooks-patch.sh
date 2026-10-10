#!/usr/bin/env bash
# firstmate-hooks-patch.sh — keep upstream Firstmate's Codex hooks off a login shell.
#
# Upstream .codex/hooks.json runs every hook as `bash -lc '…'`. Inside the nono
# sandbox a login shell tries to read ~/.profile and prints
#   /usr/bin/bash: /home/vscode/.profile: Permission denied
# on every SessionStart, PreToolUse and Stop hook (measured 2026-10-10 with the
# roe-firstmate-codex-captain profile). The hooks need no login environment, so
# we run them with `bash -c`. Until upstream changes, setup applies this as a
# known local patch, and recognises it so a later setup doesn't refuse the
# "dirty" checkout.
#
#   firstmate-hooks-patch.sh set-aside DIR  # if our patch is the ONLY change, undo it (exit 0);
#                                           # any other local change → exit 1, nothing touched
#   firstmate-hooks-patch.sh check DIR      # read-only: clean, or ONLY our exact patch (exit 0); else exit 1
#   firstmate-hooks-patch.sh apply DIR      # apply the patch to the checked-out hooks.json
set -euo pipefail
HOOKS=.codex/hooks.json
patched() { sed "s/bash -lc '/bash -c '/g"; }

cmd="${1:-}"; dir="${2:-}"
[[ -n "$cmd" && -d "$dir/.git" ]] || { echo "usage: $0 check|set-aside|apply <firstmate-dir>" >&2; exit 2; }

# 0 = clean, 10 = only our exact patch, 1 = anything else. Read-only.
state() {
  local status; status="$(git -C "$dir" status --porcelain)"
  [[ -z "$status" ]] && return 0
  [[ "$status" == " M $HOOKS" ]] || return 1
  # Only our exact substitution of the committed file counts as ours.
  git -C "$dir" show "HEAD:$HOOKS" | patched | cmp -s - "$dir/$HOOKS" && return 10
  return 1
}

case "$cmd" in
  check)
    rc=0; state || rc=$?
    [[ "$rc" == 0 || "$rc" == 10 ]] && exit 0 || exit 1
    ;;
  set-aside)
    rc=0; state || rc=$?
    [[ "$rc" == 0 ]] && exit 0
    [[ "$rc" == 10 ]] || exit 1
    git -C "$dir" checkout --quiet -- "$HOOKS"
    ;;
  apply)
    [[ -f "$dir/$HOOKS" ]] || exit 0
    tmp="$(mktemp)"; patched < "$dir/$HOOKS" > "$tmp"
    if cmp -s "$tmp" "$dir/$HOOKS"; then rm -f "$tmp"; else mv "$tmp" "$dir/$HOOKS"; fi
    ;;
  *) echo "usage: $0 check|set-aside|apply <firstmate-dir>" >&2; exit 2 ;;
esac
