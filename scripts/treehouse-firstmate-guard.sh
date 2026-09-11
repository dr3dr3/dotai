#!/usr/bin/env bash
# Fail-closed Treehouse wrapper for the bounded RoE Firstmate pilot.
#
# Firstmate currently invokes `treehouse get` without a durable lease. Until
# upstream lease and filesystem-identity fixes land, this wrapper prevents the
# two conditions that can hand out an unsafe slot: more active tasks than the
# pilot allows, and pool exhaustion. It also forces worktrees onto the
# per-repository Docker volume.

set -euo pipefail

REAL_TREEHOUSE="${ROE_TREEHOUSE_REAL:-$HOME/.local/lib/roe-firstmate/treehouse}"
PROJECT_ROOT="${ROE_FIRSTMATE_PROJECT_ROOT:-/workspace/repos}"
MAX_SLOTS="${ROE_FIRSTMATE_MAX_SLOTS:-4}"
MAX_ACTIVE="${ROE_FIRSTMATE_MAX_ACTIVE_TASKS:-2}"

die() {
  printf 'treehouse-firstmate-guard: %s\n' "$*" >&2
  exit 1
}

[[ -x "$REAL_TREEHOUSE" ]] || die "verified Treehouse binary missing at $REAL_TREEHOUSE; run setup-firstmate.sh"
[[ "$MAX_SLOTS" =~ ^[1-9][0-9]*$ ]] || die "ROE_FIRSTMATE_MAX_SLOTS must be a positive integer"
[[ "$MAX_ACTIVE" =~ ^[1-9][0-9]*$ ]] || die "ROE_FIRSTMATE_MAX_ACTIVE_TASKS must be a positive integer"
(( MAX_ACTIVE < MAX_SLOTS )) || die "active-task limit must be lower than the slot limit"

# Treehouse appends its own `treehouse/` pool directory. A relative root is
# resolved from the repository root, keeping every slot on the named volume.
export TREEHOUSE_ROOT=.

same_identity() {
  local left="$1" right="$2" left_id right_id
  if [[ "$(uname -s)" == Darwin ]]; then
    left_id="$(stat -f '%d:%i' "$left" 2>/dev/null)" || return 1
    right_id="$(stat -f '%d:%i' "$right" 2>/dev/null)" || return 1
  else
    left_id="$(stat -c '%d:%i' "$left" 2>/dev/null)" || return 1
    right_id="$(stat -c '%d:%i' "$right" 2>/dev/null)" || return 1
  fi
  [[ "$left_id" == "$right_id" ]]
}

guard_get() {
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v jq >/dev/null 2>&1 || die "jq is required"

  local repo_root allowed_prefix status total available occupied path
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || die "treehouse get must run inside a registered Git repository"
  repo_root="$(cd "$repo_root" && pwd -P)"
  allowed_prefix="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)/"

  [[ "$repo_root/" == "$allowed_prefix"* ]] \
    || die "project is off the RoE repository volumes: $repo_root"

  status="$("$REAL_TREEHOUSE" status --json 2>/dev/null)" \
    || die "could not inspect the Treehouse pool for $repo_root"
  jq -e 'type == "array"' >/dev/null <<<"$status" \
    || die "Treehouse returned malformed status JSON"

  total="$(jq 'length' <<<"$status")"
  available="$(jq '[.[] | select(.status == "available")] | length' <<<"$status")"
  occupied="$(jq '[.[] | select(.status != "available")] | length' <<<"$status")"

  (( occupied < MAX_ACTIVE )) \
    || die "active/unavailable slot limit reached ($occupied/$MAX_ACTIVE); finish or recover a task before spawning"
  if (( total >= MAX_SLOTS && available == 0 )); then
    die "pool has no reusable slot ($total/$MAX_SLOTS); refusing primary-checkout fallback"
  fi

  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    [[ -d "$path" ]] || die "recorded Treehouse slot is missing: $path"
    if same_identity "$repo_root" "$path"; then
      die "Treehouse pool contains the primary checkout: $path"
    fi
    [[ "$path/" == "$repo_root/.treehouse/"* ]] \
      || die "Treehouse slot is outside the in-project pool: $path"
    [[ ! -L "$path/vendor" ]] \
      || die "pooled worktree has a shared vendor symlink: $path/vendor"
    [[ ! -L "$path/node_modules" ]] \
      || die "pooled worktree has a shared node_modules symlink: $path/node_modules"
  done < <(jq -r '.[].path' <<<"$status")
}

ARGS=("$@")

if [[ "${1:-}" == get ]]; then
  capability_probe=0
  explicit_fetch_choice=0
  for arg in "$@"; do
    case "$arg" in
      -h|--help) capability_probe=1 ;;
      --no-fetch) explicit_fetch_choice=1 ;;
    esac
  done
  if (( capability_probe == 0 )); then
    guard_get

    # Git credentials are deliberately outside this sandbox, so `treehouse get`
    # can never complete its origin fetch here and refuses the local base rather
    # than guess. Choose the local base explicitly and say so, naming the commit
    # the worktree is cut from, so a stale base is a reported fact rather than a
    # silent one. Set ROE_FIRSTMATE_TREEHOUSE_FETCH=1 where credentials exist.
    if (( explicit_fetch_choice == 0 )) && [[ "${ROE_FIRSTMATE_TREEHOUSE_FETCH:-0}" != 1 ]]; then
      base_ref="$(git rev-parse --short HEAD 2>/dev/null || echo unknown)"
      base_date="$(git log -1 --format=%ci 2>/dev/null || echo unknown)"
      printf 'treehouse-firstmate-guard: origin fetch skipped (no credentials in sandbox); cutting the worktree from local %s (%s), which may be behind origin.\n' \
        "$base_ref" "$base_date" >&2
      ARGS+=(--no-fetch)
    fi
  fi
fi

exec "$REAL_TREEHOUSE" "${ARGS[@]}"
