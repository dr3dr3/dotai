#!/usr/bin/env bash
# Rock of Eye — multi-instance docker guardrail (Claude Code PreToolUse hook)
# ---------------------------------------------------------------------------
# Blocks a Bash command that addresses a service container belonging to a
# DIFFERENT local-dev-env instance than the one this devcontainer runs.
#
# Why: two instances (roe-* and roe2-*) share a single Docker daemon, so every
# container is addressable from either devcontainer. A bare `docker exec roe-api`
# run from the roe2 devcontainer silently operates on the wrong stack — and
# `docker exec roe-api git commit ...` lands a commit in the wrong instance's
# volume. This hook catches the wrong prefix before it runs.
#
# Scope: "block wrong-prefix only". Correct-prefix commands and all `make exec-*`
# (which resolve the prefix from ROE_INSTANCE) pass through untouched.
#
# Escape hatch: append `# roe-xinstance-ok` to a command to intentionally allow
# cross-instance addressing.
#
# Contract: PreToolUse hook. Reads the tool-call JSON on stdin; exit 2 + stderr
# blocks the call and feeds the reason back to the agent. Any other failure
# exits 0 (fail-open) so a hook bug never wedges the session.

set -uo pipefail

input="$(cat)"

tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
[ "$tool" = "Bash" ] || exit 0

cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty' 2>/dev/null)"
[ -n "$cmd" ] || exit 0

# Only relevant for commands that address containers directly.
printf '%s' "$cmd" | grep -qE '\bdocker[[:space:]]' || exit 0

# Explicit opt-out.
printf '%s' "$cmd" | grep -qE 'roe-xinstance-ok' && exit 0

# ── Determine THIS instance's container prefix ──────────────────────────────
# Primary source: ROE_INSTANCE in the project's .env (roe / roe2 / roe3 ...).
PROJECT_DIR="${CLAUDE_PROJECT_DIR:-/workspace}"
my_prefix=""
for env_file in "$PROJECT_DIR/.env" /workspace/.env; do
  if [ -f "$env_file" ]; then
    inst="$(grep -E '^ROE_INSTANCE=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2 | tr -d ' "'"'"'')"
    my_prefix="roe${inst}"
    break
  fi
done
# Fallback: derive from the devcontainer's compose-project label.
if [ -z "${my_prefix:-}" ] || [ "$my_prefix" = "roe" -a ! -f "$PROJECT_DIR/.env" ]; then
  proj="$(docker inspect "$(hostname)" --format '{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null)"
  case "$proj" in
    *-2)  my_prefix="roe2" ;;
    *-3)  my_prefix="roe3" ;;
    *)    my_prefix="${my_prefix:-roe}" ;;
  esac
fi

# ── Find container tokens belonging to a different instance ─────────────────
# Precise service-suffix allowlist so volume names / paths don't false-match.
suffixes='api-worker|api|sso|pms-core|mysql|redis|mailpit|s3|all-in-one-portal|client-portal|partner-portal|adminer|cloudbeaver|playwright'
# leading guard: not preceded by an identifier char (avoids embedded volume refs)
hits="$(printf '%s' "$cmd" \
  | grep -oE "(^|[^A-Za-z0-9_.-])roe[0-9]*-(${suffixes})([^A-Za-z0-9-]|$)" 2>/dev/null \
  | grep -oE "roe[0-9]*-(${suffixes})" \
  | sort -u)"

[ -n "$hits" ] || exit 0

violations=""
while IFS= read -r token; do
  [ -n "$token" ] || continue
  token_prefix="${token%%-*}"          # roe / roe2 / roe3
  if [ "$token_prefix" != "$my_prefix" ]; then
    violations="${violations}  • ${token}  (instance '${token_prefix}', you are in '${my_prefix}')"$'\n'
  fi
done <<< "$hits"

[ -n "$violations" ] || exit 0

cat >&2 <<EOF
⛔ Cross-instance docker command blocked.

This devcontainer is instance '${my_prefix}', but the command targets containers
from another instance:
${violations}
Fix one of these ways:
  • Use 'make exec-api' / 'make exec-sso' / 'make exec-pms-core' — they resolve
    the right prefix ('${my_prefix}-') from .env (ROE_INSTANCE) automatically.
  • Or replace the prefix with '${my_prefix}-' (e.g. ${my_prefix}-api).
  • Running git inside a service container crosses instances — do git work in
    the devcontainer checkout (/workspace/repos/<repo>), not via docker exec.

Intentional? Append '# roe-xinstance-ok' to the command to override.
EOF
exit 2
