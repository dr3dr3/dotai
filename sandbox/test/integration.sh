#!/usr/bin/env bash
# =============================================================================
# Tier 1 — local integration tests. REQUIRES Docker (run on your OrbStack host).
# =============================================================================
# Builds the images and proves the live security properties end-to-end:
#   A. topology      — agent has NO direct internet route (bypassing the proxy fails)
#   B. allowlist ok  — an allowlisted host succeeds THROUGH the proxy
#   C. allowlist deny— a non-allowlisted host is blocked by the proxy
#   D. fail-closed   — with the proxy stopped, the agent cannot reach the internet
#   E. full run      — a real two-phase run (clone → boundary → agent self-test) passes
#
# Usage:  bash sandbox/test/integration.sh [--no-build]
#
# Portable: uses the base compose only (no host-specific mounts, no secrets), so it
# runs identically on Docker Desktop (Windows/WSL2), OrbStack (macOS), and Linux.
# On Windows, run it from a WSL2 shell (bash + the Docker Desktop CLI).
# =============================================================================
set -uo pipefail

SANDBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f $SANDBOX/compose/docker-compose.yml"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
agent_bash() { $COMPOSE run --rm --entrypoint bash agent -lc "$1" 2>/dev/null; }

command -v docker >/dev/null 2>&1 || { echo "✖ docker not found — run this on a Docker host"; exit 1; }
trap '$COMPOSE down -v >/dev/null 2>&1 || true' EXIT

echo "── Tier 1: local integration (Docker) ──"

# Build ----------------------------------------------------------------------
if [ "${1:-}" != "--no-build" ]; then
  echo "0. building images (agent + egress)…"
  bash "$SANDBOX"/image/build.sh >/tmp/sb-build.log 2>&1 && ok "images built" \
    || { bad "build failed — see /tmp/sb-build.log"; tail -20 /tmp/sb-build.log; exit 1; }
fi

# A. No direct route (topology, not just proxy env) --------------------------
echo "A. agent has no direct internet route"
code="$(agent_bash 'curl -s --noproxy "*" --max-time 6 -o /dev/null -w "%{http_code}" https://api.github.com/zen; echo " exit=$?"')"
case "$code" in
  *"000 exit="*|*"exit=28"*|*"exit=7"*|*"exit=6"*) ok "direct egress fails (no route): [$code]" ;;
  *"200"*) bad "direct egress SUCCEEDED — the agent can bypass the proxy! [$code]" ;;
  *) ok "direct egress did not succeed: [$code]" ;;
esac

# B. Allowlisted host succeeds via the proxy ---------------------------------
echo "B. allowlisted host via proxy"
code="$(agent_bash 'curl -s --max-time 10 -o /dev/null -w "%{http_code}" https://api.github.com/zen')"
[ "$code" = "200" ] && ok "api.github.com/zen → 200 through proxy" || bad "expected 200, got [$code]"

# C. Non-allowlisted host blocked --------------------------------------------
echo "C. non-allowlisted host blocked"
res="$(agent_bash 'curl -s --max-time 10 -o /dev/null -w "%{http_code}" https://example.com; echo " exit=$?"')"
case "$res" in
  *"200 exit=0"*) bad "example.com was REACHABLE — allowlist not enforcing! [$res]" ;;
  *) ok "example.com blocked by allowlist: [$res]" ;;
esac

# D. Fail-closed: stop the proxy, confirm no egress --------------------------
# --no-deps is essential: a plain `compose run agent` would restart egress to
# satisfy the agent's depends_on(service_healthy), resurrecting the proxy we just
# stopped and defeating the test. With --no-deps the agent runs alone, proxy down.
echo "D. fail-closed (proxy down)"
$COMPOSE up -d egress >/dev/null 2>&1
$COMPOSE stop egress >/dev/null 2>&1
res="$($COMPOSE run --rm --no-deps --entrypoint bash agent -lc 'curl -s --max-time 6 -o /dev/null -w "%{http_code}" https://api.github.com/zen; echo " exit=$?"' 2>/dev/null)"
case "$res" in
  *"200 exit=0"*) bad "egress worked with proxy DOWN — not fail-closed! [$res]" ;;
  *) ok "no egress when proxy is down: [$res]" ;;
esac

# E. Full two-phase run with the self-test profile ---------------------------
echo "E. full run: clone → boundary → agent self-test"
out="$($COMPOSE run --rm \
  -e SANDBOX_PROFILE=selftest \
  -e SANDBOX_REPOS_YAML=/opt/sandbox/test/fixtures/repos.yaml \
  -e SANDBOX_GRAPH_DISABLE=1 \
  -e SENTRY_TOKEN=ro_demo \
  -e GITHUB_TOKEN=ghp_should_be_dropped_xxxxxxxxxxxxxxxx \
  agent 2>&1)"; rc=$?
echo "$out" | sed 's/^/    /'
if [ "$rc" -eq 0 ] && echo "$out" | grep -q "agent-phase self-test PASSED"; then
  ok "full run passed (boundary held, clone read-only, RO token crossed)"
else
  bad "full run failed (rc=$rc)"
fi

echo ""
echo "── Tier 1 result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
