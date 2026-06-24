#!/usr/bin/env bash
# =============================================================================
# Agent-phase assertions — run AS the harness via the `selftest` profile.
# =============================================================================
# entrypoint.sh execs this in the locked-down agent phase. It proves, from the
# INSIDE, that the two-phase boundary held: write creds are gone, RO tokens and
# context are present, and the working tree is read-only. Exits non-zero on any
# failure so `docker compose run` / CI surfaces it.
# =============================================================================
set -uo pipefail

FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }

echo "── agent-phase self-test (inside the box) ──"

# 1. Write-capable secrets must NOT be present here.
for v in GITHUB_TOKEN SSH_AUTH_SOCK NPM_TOKEN; do
  if [ -n "${!v:-}" ]; then bad "$v is present in agent phase (boundary leak!)"; else ok "$v absent"; fi
done

# 2. Egress proxy must be configured.
[ -n "${HTTPS_PROXY:-}" ] && ok "HTTPS_PROXY set ($HTTPS_PROXY)" || bad "HTTPS_PROXY not set"

# 3. Substrate-guaranteed context env.
[ -n "${SANDBOX_WORKDIR:-}" ] && ok "SANDBOX_WORKDIR set" || bad "SANDBOX_WORKDIR unset"
[ -n "${SANDBOX_GRAPH_DIR:-}" ] && ok "SANDBOX_GRAPH_DIR set" || bad "SANDBOX_GRAPH_DIR unset"

# 4. RO tokens crossed the boundary (sourced by 20-agent.sh before exec).
[ -n "${SENTRY_TOKEN:-}" ] && ok "RO token present (SENTRY_TOKEN)" \
  || printf '  \033[33m! SENTRY_TOKEN not set (pass -e SENTRY_TOKEN=… to assert it)\033[0m\n'

# 5. The codebase was cloned, and is READ-ONLY.
if [ -d "$SANDBOX_WORKDIR" ] && [ -n "$(ls -A "$SANDBOX_WORKDIR" 2>/dev/null)" ]; then
  ok "codebase present at SANDBOX_WORKDIR"
  probe="$(find "$SANDBOX_WORKDIR" -type f 2>/dev/null | head -1)"
  if [ -n "$probe" ]; then
    if echo x >> "$probe" 2>/dev/null; then bad "working tree is WRITABLE ($probe)"; else ok "working tree is read-only"; fi
  fi
else
  printf '  \033[33m! SANDBOX_WORKDIR empty (no repos.yaml fixture mounted?)\033[0m\n'
fi

echo ""
[ "$FAIL" -eq 0 ] && echo "✅ agent-phase self-test PASSED" || echo "❌ agent-phase self-test FAILED ($FAIL)"
exit "$FAIL"
