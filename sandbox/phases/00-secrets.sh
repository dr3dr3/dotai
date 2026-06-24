#!/usr/bin/env bash
# =============================================================================
# Phase 0 — resolve secrets into the CURRENT shell environment.
# =============================================================================
# Sourced by entrypoint.sh (NOT exec'd) so the exports land in the orchestrator
# shell and are visible to 10-setup. These secrets are deliberately NOT carried
# across the SETUP→AGENT boundary (see entrypoint.sh `env -i`).
#
# Two backends, selected by SANDBOX_ENV:
#   local    — varlock resolves op:// refs via the mounted 1Password agent.sock
#              (biometric unlock on the macOS host). Same mechanism the devcontainer
#              already uses. Define refs in a .env (op:// values) varlock can read.
#   fargate  — ECS injects secrets from Secrets Manager as env vars already (see
#              deploy/task-definition.json `secrets`). Nothing to resolve; they are
#              already in this environment.
# =============================================================================
set -euo pipefail

case "${SANDBOX_ENV:-local}" in
  local)
    if command -v varlock >/dev/null 2>&1; then
      # varlock reads op:// refs (from a .env it's pointed at) and resolves them
      # against the 1Password agent. `varlock load --format shell` prints exports.
      if varlock load --format shell >/tmp/.sandbox-secrets 2>/dev/null; then
        # shellcheck disable=SC1091
        set -a; source /tmp/.sandbox-secrets; set +a
        rm -f /tmp/.sandbox-secrets
        echo "  ✓ secrets resolved via varlock (op:// → env)"
      else
        echo "  ⚠ varlock found but resolved nothing — continuing with ambient env"
      fi
    else
      echo "  ⚠ varlock not installed — using ambient env (set secrets manually for local dev)"
    fi
    ;;
  fargate)
    # ECS already injected Secrets Manager values as env vars. Nothing to do.
    echo "  ✓ secrets injected by ECS (Secrets Manager) — present in env"
    ;;
  *)
    echo "  ✖ unknown SANDBOX_ENV='${SANDBOX_ENV}' (expected local|fargate)" >&2
    exit 1
    ;;
esac
