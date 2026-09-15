#!/usr/bin/env bash
# =============================================================================
# roe-lease — run one command with one leased capability (worker side)
# =============================================================================
# ADR-2026-09-14-1 D6. Inside a Firstmate worker sandbox, credentials are not in
# the environment — nono's base profile denies *_TOKEN, *_API_KEY, AWS_*,
# LINEAR_*, OP_* by name. What a worker has instead is read-only access to its
# own lease directory, written by `fm-grant` on the captain side. This shim is
# the single way a worker turns a lease into a credential:
#
#   roe-lease read_sentry -- sentry issues list --project rock-of-eye-api-prod
#   roe-lease read_aws_staging -- aws logs tail /roe/staging/api --since 1h
#
# It checks the lease exists and has not expired, execs the command with ONLY
# that capability's variables added to the environment, and appends one line
# to the use log first. That log is what makes "which agent used which
# credential on which task" answerable; the exec-with-only-these-vars is what
# keeps a Sentry-reading worker from also holding a write token by accident.
#
#   roe-lease --list          what this slot currently holds (never values)
#   roe-lease <cap> --check   exit 0 if usable, 2 if missing, 3 if expired
#
# A missing or expired lease is a hard stop with a message that names the
# capability and the captain command that would grant it. The worker cannot
# widen its own authority — the profile's denied list is enforced by fm-grant
# refusing, and there is no path from here to the vault.
# =============================================================================
set -euo pipefail

PROFILES="${ROE_FIRSTMATE_AUTHORITY_PROFILES:-/workspace/.ai/ai-devex/firstmate/authority-profiles.json}"

die() { printf 'roe-lease: %s\n' "$*" >&2; exit "${2:-1}"; }
usage() { sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; }

# Same derivation as fm-grant — the two must agree byte for byte.
slot_id_from_path() {
  local p; p="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  [[ "$p" == */.treehouse/*/*/workspace ]] || return 1
  p="${p#/workspace/}"; p="${p%/workspace}"
  p="${p//\/.treehouse\//--}"; p="${p/#.treehouse\//local-dev-env--}"
  p="${p//\//--}"; p="${p//./_}"   # no dots: never a hidden dir, never path-like
  [[ -n "$p" ]] && printf '%s\n' "$p"
}

# Find this worker's slot from the cwd: walk up to the Treehouse slot root.
find_slot_root() {
  local d; d="$(pwd -P)"
  while [[ "$d" != / ]]; do
    [[ "$d" == */.treehouse/*/*/workspace ]] && { printf '%s\n' "$d"; return 0; }
    d="$(dirname "$d")"
  done
  return 1
}

# The lease/use roots come from the catalogue when readable; the worker profile
# may not grant the catalogue file, so fall back to the documented defaults.
LEASE_ROOT="$HOME/.cache/roe-firstmate/leases"; USE_ROOT="$HOME/.cache/roe-firstmate/tmp/lease-use"
if [[ -r "$PROFILES" ]] && command -v jq >/dev/null 2>&1; then
  v="$(jq -r '.lease_defaults.lease_root // empty' "$PROFILES" 2>/dev/null || true)"; [[ -n "$v" ]] && LEASE_ROOT="${v/\$HOME/$HOME}"
  v="$(jq -r '.lease_defaults.use_log_root // empty' "$PROFILES" 2>/dev/null || true)"; [[ -n "$v" ]] && USE_ROOT="${v/\$HOME/$HOME}"
fi

[[ $# -ge 1 ]] || { usage; exit 2; }
[[ "$1" == -h || "$1" == --help ]] && { usage; exit 0; }

SLOT_ROOT="${ROE_LEASE_SLOT_ROOT:-$(find_slot_root || true)}"
[[ -n "$SLOT_ROOT" ]] || die "not inside a Treehouse worker slot (…/.treehouse/<ws>/<n>/workspace)" 2
SLOT_ID="$(slot_id_from_path "$SLOT_ROOT")" || die "cannot derive a slot id from $SLOT_ROOT" 2
SLOT_DIR="$LEASE_ROOT/$SLOT_ID"

if [[ "$1" == --list ]]; then
  [[ -d "$SLOT_DIR" ]] || { echo "no leases for this slot ($SLOT_ID)"; exit 0; }
  for f in "$SLOT_DIR"/*.env; do [[ -f "$f" ]] && printf '%s  %s\n' "$(basename "${f%.env}")" "$(grep -m1 '^# lease' "$f" | sed 's/^# lease //')"; done
  exit 0
fi

CAP="$1"; shift
[[ "$CAP" =~ ^[a-z][a-z0-9_]{2,63}$ ]] || die "bad capability name: $CAP" 2
LEASE="$SLOT_DIR/$CAP.env"

[[ -f "$LEASE" ]] || die "no lease for $CAP in this slot. Ask the captain: fm-grant --slot $SLOT_ROOT --task <id> --cap $CAP" 2

header="$(grep -m1 '^# lease ' "$LEASE" || true)"
expires="$(sed -n 's/.* expires_at=\([^ ]*\).*/\1/p' <<<"$header")"
[[ -n "$expires" ]] || die "lease for $CAP has no expiry header — refusing" 3
exp_epoch="$(date -u -d "$expires" +%s 2>/dev/null || date -u -j -f %Y-%m-%dT%H:%M:%SZ "$expires" +%s 2>/dev/null)" || die "unparseable expiry $expires" 3
if [[ "$(date -u +%s)" -ge "$exp_epoch" ]]; then
  die "lease for $CAP expired at $expires. Ask the captain to re-grant: fm-grant --slot $SLOT_ROOT --task <id> --cap $CAP" 3
fi

if [[ "${1:-}" == --check ]]; then echo "$CAP usable until $expires"; exit 0; fi
[[ "${1:-}" == -- ]] && shift
[[ $# -ge 1 ]] || die "nothing to run: roe-lease $CAP -- <command…>" 2

# Use log — one line per invocation, argv[0] only, never arguments (which could carry data).
mkdir -p "$USE_ROOT/$SLOT_ID" 2>/dev/null || true
printf '%s cap=%s cmd=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$CAP" "$(basename "$1")" >>"$USE_ROOT/$SLOT_ID/$CAP.log" 2>/dev/null || true

# Load ONLY this lease's variables, then exec. The file is KEY='value' lines
# written by fm-grant; sourcing is the parser, in a shell that then execs.
set -a
# shellcheck disable=SC1090  # the lease file written by fm-grant
. "$LEASE"
set +a
exec "$@"
