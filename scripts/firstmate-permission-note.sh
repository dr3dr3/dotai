#!/usr/bin/env bash
# Record a capability Firstmate needed; recording is not authorization.

set -euo pipefail

FM_HOME="${FM_HOME:-/workspace/.firstmate-home}"
LEDGER="${ROE_FIRSTMATE_PERMISSION_LEDGER:-$FM_HOME/data/permission-needs.jsonl}"

usage() {
  cat <<'EOF'
Usage:
  fm-permission-note \
    --boundary filesystem|network|credential|process|cloud-authority \
    --access read|write|execute|connect|plan|apply \
    --resource <logical resource> \
    --reason <why the workflow needs it> \
    [--evidence declared|denial|successful-off-mode]

Do not include secret values, tokens, passwords, or complete credential-bearing
commands. A ledger entry records evidence for later review; it grants nothing.
EOF
}

die() {
  printf 'fm-permission-note: %s\n' "$*" >&2
  exit 2
}

boundary=""
access=""
resource=""
reason=""
evidence="declared"

while (($#)); do
  case "$1" in
    --boundary)
      (($# >= 2)) || die "--boundary requires a value"
      boundary="$2"
      shift 2
      ;;
    --access)
      (($# >= 2)) || die "--access requires a value"
      access="$2"
      shift 2
      ;;
    --resource)
      (($# >= 2)) || die "--resource requires a value"
      resource="$2"
      shift 2
      ;;
    --reason)
      (($# >= 2)) || die "--reason requires a value"
      reason="$2"
      shift 2
      ;;
    --evidence)
      (($# >= 2)) || die "--evidence requires a value"
      evidence="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

case "$boundary" in
  filesystem|network|credential|process|cloud-authority) ;;
  *) die "invalid --boundary: ${boundary:-<empty>}" ;;
esac
case "$access" in
  read|write|execute|connect|plan|apply) ;;
  *) die "invalid --access: ${access:-<empty>}" ;;
esac
case "$evidence" in
  declared|denial|successful-off-mode) ;;
  *) die "invalid --evidence: ${evidence:-<empty>}" ;;
esac
[[ -n "$resource" ]] || die "--resource must not be empty"
[[ -n "$reason" ]] || die "--reason must not be empty"
command -v python3 >/dev/null 2>&1 || die "python3 is required"

candidate="$resource $reason"
if [[ "$candidate" == *"-----BEGIN "* ]] \
  || [[ "$candidate" =~ (ghp_|github_pat_|AKIA|ASIA|Bearer[[:space:]]+)[^[:space:]]{12,} ]] \
  || [[ "$candidate" =~ (token|password|secret|api[_-]?key)[=:][^[:space:]]+ ]]; then
  die "refusing text that looks like a secret; record only logical resource names"
fi

role="${ROE_FIRSTMATE_ROLE:-unknown}"
case "$role" in
  captain|worker|unknown) ;;
  *) role=unknown ;;
esac

sandbox_mode="unknown"
mode_file="${ROE_FIRSTMATE_SANDBOX_MODE_FILE:-$HOME/.config/roe-firstmate/sandbox-mode}"
if [[ ! -e "$mode_file" ]]; then
  sandbox_mode=on
elif [[ "$(<"$mode_file")" == on || "$(<"$mode_file")" == off ]]; then
  sandbox_mode="$(<"$mode_file")"
fi

git_root=""
git_sha=""
if git_root="$(git rev-parse --show-toplevel 2>/dev/null)"; then
  git_sha="$(git -C "$git_root" rev-parse HEAD 2>/dev/null || true)"
fi

umask 077
mkdir -p "$(dirname "$LEDGER")"
python3 - \
  "$LEDGER" "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$role" "$boundary" "$access" \
  "$resource" "$reason" "$evidence" "$sandbox_mode" "$git_root" "$git_sha" <<'PY'
import fcntl
import json
import os
import sys

(
    ledger,
    recorded_at,
    role,
    boundary,
    access,
    resource,
    reason,
    evidence,
    sandbox_mode,
    git_root,
    git_sha,
) = sys.argv[1:]

record = {
    "schema": "roe-firstmate-permission-need.v1",
    "recorded_at": recorded_at,
    "role": role,
    "boundary": boundary,
    "access": access,
    "resource": resource,
    "reason": reason,
    "evidence": evidence,
    "sandbox_mode": sandbox_mode,
    "git_root": git_root,
    "git_sha": git_sha,
    "disposition": "captured",
}

fd = os.open(ledger, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
with os.fdopen(fd, "a", encoding="utf-8") as stream:
    fcntl.flock(stream, fcntl.LOCK_EX)
    stream.write(json.dumps(record, separators=(",", ":")) + "\n")
    stream.flush()
    os.fsync(stream.fileno())
PY

printf 'Captured permission need in %s; no permission was granted.\n' "$LEDGER"
