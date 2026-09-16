#!/usr/bin/env bash
# =============================================================================
# fm-grant — lease a capability to one Firstmate worker slot (captain side)
# =============================================================================
# ADR-2026-09-14-1 D6: crew are not the captain. A worker never inherits a
# person's credentials; it is LEASED a bot credential, per slot, with an expiry,
# and every use is logged. This script is the human/captain half. The worker
# half is `roe-lease` (scripts/firstmate-lease.sh).
#
# What a lease is: a file
#   $LEASE_ROOT/<slot-id>/<capability>.env      (mode 0600)
# holding the capability's variables as KEY='value' lines under a header that
# records task, expiry and grantor. The worker's nono sandbox is given
# read-only access to exactly its own <slot-id> directory at launch
# (firstmate-harness-sandbox.sh), so a worker can read its leases and nothing
# else. `roe-lease <cap> -- <cmd>` inside the worker checks expiry, execs the
# command with ONLY that capability's variables set, and appends a use record.
#
# Where credentials come from — never from the captain's own logins:
#   kind=op   an item in the 1Password vault "ROE - AI Agents", read with the
#             crew SERVICE ACCOUNT token (ROE_AI_AGENTS_OP_TOKEN, a cto-tier
#             row of local-dev-env's tooling manifest). In-container `op` has
#             no personal identity; the service account is the only op path.
#   kind=aws  `aws configure export-credentials` from a READ-ONLY permission
#             set profile (default roe-staging-readonly). Short-lived by nature.
#
# The catalogue of capabilities is the shared contract in
#   ai-devex/firstmate/authority-profiles.json  ("capabilities", "lease_defaults")
# — this script adds nothing to it. A capability that is not in the catalogue
# cannot be granted.
#
# Usage:
#   fm-grant --slot <treehouse-slot-path> --task <task-id> --cap <cap> [--cap <cap>…] [--ttl <seconds>]
#   fm-grant --slot <path> --task <id> --defaults          # every capability the profile allows at launch
#   fm-grant --slot <path> --revoke [--cap <cap>]           # delete one lease, or all for the slot
#   fm-grant --slot <path> --status                         # what is leased, expiry, use counts
#   fm-grant --list                                         # every slot with leases
#
# Never prints a credential value. Exits non-zero if any requested capability
# could not be resolved — a lease that silently holds nothing is worse than none.
# =============================================================================
set -euo pipefail

PROFILES="${ROE_FIRSTMATE_AUTHORITY_PROFILES:-/workspace/.ai/ai-devex/firstmate/authority-profiles.json}"
TOOLING_ENV="${ROE_TOOLING_STORE:-$HOME/.config/roe/tooling.env}"
PROFILE_NAME="${ROE_FIRSTMATE_AUTHORITY_PROFILE:-local-supervised}"

die() { printf 'fm-grant: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,45p' "$0" | sed 's/^# \{0,1\}//'; }

command -v jq >/dev/null 2>&1 || die "jq is required"
[[ -f "$PROFILES" ]] || die "authority profiles not found: $PROFILES (run make ai-devex)"

# --- shared with roe-lease: slot id from a Treehouse slot path ---------------
# /workspace/repos/rock-of-eye-api/.treehouse/<ws>/<n>/workspace -> repos--rock-of-eye-api--<ws>--<n>
# /workspace/.treehouse/<ws>/<n>/workspace                         -> workspace--<ws>--<n>
slot_id_from_path() {
  local p; p="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
  [[ "$p" == */.treehouse/*/*/workspace ]] || return 1
  p="${p#/workspace/}"; p="${p%/workspace}"
  p="${p//\/.treehouse\//--}"; p="${p/#.treehouse\//local-dev-env--}"
  p="${p//\//--}"; p="${p//./_}"   # no dots: never a hidden dir, never path-like
  [[ -n "$p" ]] && printf '%s\n' "$p"
}

LEASE_ROOT="$(jq -r '.lease_defaults.lease_root' "$PROFILES")"; LEASE_ROOT="${LEASE_ROOT/\$HOME/$HOME}"
USE_ROOT="$(jq -r '.lease_defaults.use_log_root' "$PROFILES")"; USE_ROOT="${USE_ROOT/\$HOME/$HOME}"
VAULT="$(jq -r '.lease_defaults.vault' "$PROFILES")"
DEFAULT_TTL="$(jq -r '.lease_defaults.ttl_seconds' "$PROFILES")"

SLOT=""; TASK=""; CAPS=(); TTL="$DEFAULT_TTL"; MODE="grant"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --slot) SLOT="${2:?}"; shift 2 ;;
    --task) TASK="${2:?}"; shift 2 ;;
    --cap) CAPS+=("${2:?}"); shift 2 ;;
    --ttl) TTL="${2:?}"; shift 2 ;;
    --defaults) MODE="defaults"; shift ;;
    --revoke) MODE="revoke"; shift ;;
    --status) MODE="status"; shift ;;
    --list) MODE="list"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1 (see --help)" ;;
  esac
done

if [[ "$MODE" == list ]]; then
  [[ -d "$LEASE_ROOT" ]] || { echo "no leases"; exit 0; }
  for d in "$LEASE_ROOT"/*/; do
    [[ -d "$d" ]] || continue
    printf '%s\n' "$(basename "$d")"
    for f in "$d"*.env; do [[ -f "$f" ]] && printf '  %s  %s\n' "$(basename "${f%.env}")" "$(grep -m1 '^# lease' "$f" | sed 's/^# lease //')"; done
  done
  exit 0
fi

[[ -n "$SLOT" ]] || die "--slot <treehouse-slot-path> is required"
SLOT_ID="$(slot_id_from_path "$SLOT")" || die "not a Treehouse slot path: $SLOT (expected …/.treehouse/<ws>/<n>/workspace)"
SLOT_DIR="$LEASE_ROOT/$SLOT_ID"

case "$MODE" in
  status)
    [[ -d "$SLOT_DIR" ]] || { echo "no leases for $SLOT_ID"; exit 0; }
    for f in "$SLOT_DIR"/*.env; do
      [[ -f "$f" ]] || continue
      cap="$(basename "${f%.env}")"
      uses=0; [[ -f "$USE_ROOT/$SLOT_ID/$cap.log" ]] && uses="$(wc -l <"$USE_ROOT/$SLOT_ID/$cap.log")"
      printf '%-26s %s  uses=%s\n' "$cap" "$(grep -m1 '^# lease' "$f" | sed 's/^# lease //')" "$uses"
    done
    exit 0 ;;
  revoke)
    if [[ ${#CAPS[@]} -gt 0 ]]; then
      for c in "${CAPS[@]}"; do rm -f "$SLOT_DIR/$c.env" && echo "revoked $c for $SLOT_ID"; done
    else
      rm -rf "$SLOT_DIR" && echo "revoked all leases for $SLOT_ID"
    fi
    exit 0 ;;
esac

[[ -n "$TASK" ]] || die "--task <task-id> is required to grant"
[[ "$TTL" =~ ^[0-9]+$ ]] && [[ "$TTL" -ge 60 ]] && [[ "$TTL" -le 86400 ]] || die "--ttl must be 60..86400 seconds"

if [[ "$MODE" == defaults ]]; then
  # Every capability the profile lists as allowed AND the catalogue knows.
  mapfile -t CAPS < <(jq -r --arg p "$PROFILE_NAME" '
    (.capabilities | keys | map(select(startswith("_") | not))) as $known
    | .profiles[$p].allowed[] | select(. as $c | $known | index($c))' "$PROFILES")
  [[ ${#CAPS[@]} -gt 0 ]] || die "profile $PROFILE_NAME has no default capabilities"
fi
[[ ${#CAPS[@]} -gt 0 ]] || die "nothing to grant: pass --cap <capability> or --defaults"

# A lease_only capability is grantable; a denied one is not; an unknown one is not.
for c in "${CAPS[@]}"; do
  jq -e --arg c "$c" '.capabilities[$c] | type == "object"' "$PROFILES" >/dev/null || die "unknown capability: $c (not in the catalogue)"
  if jq -e --arg p "$PROFILE_NAME" --arg c "$c" '.profiles[$p].denied | index($c)' "$PROFILES" >/dev/null; then
    die "capability $c is DENIED for profile $PROFILE_NAME — not grantable"
  fi
done

# Resolve the crew service-account token (a cto-tier tooling row), never the captain's identity.
op_token="${ROE_AI_AGENTS_OP_TOKEN:-}"
if [[ -z "$op_token" && -f "$TOOLING_ENV" ]]; then
  # shellcheck disable=SC1090  # the store written by make tool-auth
  op_token="$(set -a; . "$TOOLING_ENV"; set +a; printf '%s' "${ROE_AI_AGENTS_OP_TOKEN:-}")"
fi

now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
expiry_iso() { date -u -d "@$(( $(date +%s) + TTL ))" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -r "$(( $(date +%s) + TTL ))" +%Y-%m-%dT%H:%M:%SZ; }
shquote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }

install -d -m 0700 "$SLOT_DIR"
granted=0; failed=0
for c in "${CAPS[@]}"; do
  kind="$(jq -r --arg c "$c" '.capabilities[$c].source.kind' "$PROFILES")"
  tmp="$(mktemp)"
  # Subshell: stdout is the lease file; stderr passes through; `exit 9` aborts only this capability.
  (
    printf '# lease cap=%s task=%s slot=%s granted_at=%s expires_at=%s granted_by=%s\n' \
      "$c" "$TASK" "$SLOT_ID" "$(now_iso)" "$(expiry_iso)" "${USER:-unknown}"
    ok=1
    case "$kind" in
      op)
        [[ -n "$op_token" ]] || { echo "fm-grant: $c needs ROE_AI_AGENTS_OP_TOKEN (cto-tier tooling row) — run make tool-auth" >&2; ok=0; }
        item="$(jq -r --arg c "$c" '.capabilities[$c].source.item' "$PROFILES")"
        while [[ $ok == 1 ]] && IFS=$'\t' read -r var field; do
          if val="$(OP_SERVICE_ACCOUNT_TOKEN="$op_token" op read "op://$VAULT/$item/$field" 2>/dev/null)" && [[ -n "$val" ]]; then
            printf '%s=%s\n' "$var" "$(shquote "$val")"
          else
            echo "fm-grant: $c: could not read op://$VAULT/$item/$field (item or field missing in the vault, or the service account lacks access)" >&2; ok=0
          fi
        done < <(jq -r --arg c "$c" '.capabilities[$c].source.fields | to_entries[] | "\(.key)\t\(.value)"' "$PROFILES")
        ;;
      aws)
        profile="$(jq -r --arg c "$c" '.capabilities[$c].source.profile' "$PROFILES")"
        if creds="$(aws configure export-credentials --profile "$profile" --format env-no-export 2>/dev/null)" && [[ -n "$creds" ]]; then
          while IFS='=' read -r k v; do [[ -n "$k" ]] && printf '%s=%s\n' "$k" "$(shquote "$v")"; done <<<"$creds"
          region="$(aws configure get region --profile "$profile" 2>/dev/null || true)"; [[ -n "$region" ]] && printf 'AWS_DEFAULT_REGION=%s\n' "$(shquote "$region")"
        else
          echo "fm-grant: $c: aws configure export-credentials --profile $profile failed (not logged in via make aws-login, or the profile does not exist yet)" >&2; ok=0
        fi
        ;;
      *) echo "fm-grant: $c: unknown source kind $kind" >&2; ok=0 ;;
    esac
    [[ $ok == 1 ]] || exit 9
  ) >"$tmp" && { install -m 0600 "$tmp" "$SLOT_DIR/$c.env"; granted=$((granted+1)); echo "granted $c → $SLOT_ID (task $TASK, ttl ${TTL}s)"; } || { failed=$((failed+1)); echo "FAILED $c" >&2; }
  rm -f "$tmp"
done
[[ "$failed" == 0 ]] || exit 1
