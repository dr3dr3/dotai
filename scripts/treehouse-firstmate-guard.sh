#!/usr/bin/env bash
# Fail-closed Treehouse wrapper for the bounded RoE Firstmate pilot.
#
# Ordinary workers remain confined to per-repository Docker volumes. Firstmate
# may additionally allocate a persistent second-mate home from its own exact
# repository, but only through Treehouse's durable lease interface.

set -euo pipefail

REAL_TREEHOUSE="${ROE_TREEHOUSE_REAL:-$HOME/.local/lib/roe-firstmate/treehouse}"
PROJECT_ROOT="${ROE_FIRSTMATE_PROJECT_ROOT:-/workspace/repos}"
FIRSTMATE_ROOT="${ROE_FIRSTMATE_ROOT:-/workspace/firstmate}"
SECOND_MATE_POOL_ROOT="${ROE_FIRSTMATE_SECOND_MATE_POOL_ROOT:-/workspace/.firstmate-secondmates}"
MAX_SLOTS="${ROE_FIRSTMATE_MAX_SLOTS:-4}"
MAX_ACTIVE="${ROE_FIRSTMATE_MAX_ACTIVE_TASKS:-2}"
MAX_SECOND_MATES="${ROE_FIRSTMATE_MAX_SECOND_MATES:-4}"

die() {
  printf 'treehouse-firstmate-guard: %s\n' "$*" >&2
  exit 1
}

[[ -x "$REAL_TREEHOUSE" ]] || die "verified Treehouse binary missing at $REAL_TREEHOUSE; run setup-firstmate.sh"
[[ "$MAX_SLOTS" =~ ^[1-9][0-9]*$ ]] || die "ROE_FIRSTMATE_MAX_SLOTS must be a positive integer"
[[ "$MAX_ACTIVE" =~ ^[1-9][0-9]*$ ]] || die "ROE_FIRSTMATE_MAX_ACTIVE_TASKS must be a positive integer"
[[ "$MAX_SECOND_MATES" =~ ^[1-9][0-9]*$ ]] || die "ROE_FIRSTMATE_MAX_SECOND_MATES must be a positive integer"
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
  local durable_lease="$1" lease_holder="$2"
  command -v git >/dev/null 2>&1 || die "git is required"
  command -v jq >/dev/null 2>&1 || die "jq is required"

  local repo_root allowed_prefix firstmate_root pool_prefix status total available occupied leased path
  repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || die "treehouse get must run inside a registered Git repository"
  repo_root="$(cd "$repo_root" && pwd -P)"
  allowed_prefix="$(cd "$PROJECT_ROOT" 2>/dev/null && pwd -P)/"
  firstmate_root="$(cd "$FIRSTMATE_ROOT" 2>/dev/null && pwd -P)" \
    || die "Firstmate root is unavailable: $FIRSTMATE_ROOT"

  if [[ "$repo_root" == "$firstmate_root" ]]; then
    (( durable_lease == 1 )) \
      || die "Firstmate root permits only durable second-mate leases"
    [[ "$lease_holder" =~ ^[a-z][a-z0-9_-]{0,31}$ ]] \
      || die "second-mate lease holder must match [a-z][a-z0-9_-]{0,31}"
    [[ "$SECOND_MATE_POOL_ROOT" == /* ]] \
      || die "second-mate pool root must be absolute"
    [[ ! -L "$SECOND_MATE_POOL_ROOT" ]] \
      || die "second-mate pool root must not be a symlink"
    install -d -m 0700 "$SECOND_MATE_POOL_ROOT"
    pool_prefix="$(cd "$SECOND_MATE_POOL_ROOT" && pwd -P)/"
    export TREEHOUSE_ROOT="${pool_prefix%/}"
  else
    [[ "$repo_root/" == "$allowed_prefix"* ]] \
      || die "project is off the RoE repository volumes: $repo_root"
    (( durable_lease == 0 )) \
      || die "durable leases are reserved for second-mate homes"
    pool_prefix="$repo_root/.treehouse/"
  fi

  status="$("$REAL_TREEHOUSE" status --json 2>/dev/null)" \
    || die "could not inspect the Treehouse pool for $repo_root"
  jq -e 'type == "array"' >/dev/null <<<"$status" \
    || die "Treehouse returned malformed status JSON"

  total="$(jq 'length' <<<"$status")"
  available="$(jq '[.[] | select(.status == "available")] | length' <<<"$status")"
  occupied="$(jq '[.[] | select(.status != "available")] | length' <<<"$status")"
  leased="$(jq '[.[] | select(.status == "leased")] | length' <<<"$status")"

  if [[ "$repo_root" == "$firstmate_root" ]]; then
    (( leased < MAX_SECOND_MATES )) \
      || die "persistent second-mate limit reached ($leased/$MAX_SECOND_MATES); retire a second mate before provisioning another"
  else
    (( occupied < MAX_ACTIVE )) \
      || die "active/unavailable slot limit reached ($occupied/$MAX_ACTIVE); finish or recover a task before spawning"
  fi
  if (( total >= MAX_SLOTS && available == 0 )); then
    die "pool has no reusable slot ($total/$MAX_SLOTS); refusing primary-checkout fallback"
  fi

  while IFS= read -r path; do
    [[ -n "$path" ]] || continue
    [[ -d "$path" ]] || die "recorded Treehouse slot is missing: $path"
    if same_identity "$repo_root" "$path"; then
      die "Treehouse pool contains the primary checkout: $path"
    fi
    [[ "$path/" == "$pool_prefix"* ]] \
      || die "Treehouse slot is outside the guarded pool: $path"
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
  durable_lease=0
  lease_holder=
  expect_lease_holder=0
  for arg in "$@"; do
    if (( expect_lease_holder == 1 )); then
      lease_holder="$arg"
      expect_lease_holder=0
      continue
    fi
    case "$arg" in
      -h|--help) capability_probe=1 ;;
      --no-fetch) explicit_fetch_choice=1 ;;
      --lease) durable_lease=1 ;;
      --lease-holder) expect_lease_holder=1 ;;
      --lease-holder=*) lease_holder="${arg#*=}" ;;
    esac
  done
  (( expect_lease_holder == 0 )) || die "--lease-holder requires a value"
  if [[ -n "$lease_holder" ]] && (( durable_lease == 0 )); then
    die "--lease-holder requires --lease"
  fi
  if (( capability_probe == 0 )); then
    guard_get "$durable_lease" "$lease_holder"

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
