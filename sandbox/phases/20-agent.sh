#!/usr/bin/env bash
# =============================================================================
# Phase 2 — AGENT. The harness plug-in seam.
# =============================================================================
# Reached via `exec env -i <curated>` from entrypoint.sh, so the environment here
# contains ONLY the allowlisted vars + read-only tokens. No write/push creds exist.
#
# This script is intentionally thin: it loads the selected profile, makes the RO
# tokens available, stages the harness config, and execs the harness. The harness's
# *workflow* (prompts, task loop) is out of scope — it lives inside $HARNESS_CMD.
#
# THE CONTRACT (see profiles/README.md): a profile is a sandbox/profiles/<name>.env
# defining HARNESS_CMD, HARNESS_ARGS, HARNESS_CONFIG_SRC, HARNESS_CONFIG_DST, and an
# optional SANDBOX_RUN_WRAPPER. The substrate guarantees these env vars to the harness:
#   SANDBOX_WORKDIR  SANDBOX_GRAPH_DIR  HTTP(S)_PROXY  SANDBOX_RO_TOKENS
#   SANDBOX_AUDIT_GROUP  SANDBOX_PROFILE  SANDBOX_ENV
# =============================================================================
set -euo pipefail

_audit() { node "$SANDBOX_DIR/lib/audit.mjs" "$@" || true; }

PROFILE_FILE="$SANDBOX_DIR/profiles/${SANDBOX_PROFILE:?SANDBOX_PROFILE not set}.env"
if [ ! -f "$PROFILE_FILE" ]; then
  echo "✖ no profile: $PROFILE_FILE" >&2
  _audit agent.error "reason=no_profile profile=$SANDBOX_PROFILE"
  exit 1
fi

# ── Make read-only integration tokens available to the harness ───────────────
if [ -f "$SANDBOX_RO_TOKENS" ]; then
  set -a; source "$SANDBOX_RO_TOKENS"; set +a
fi

# ── Load the profile (defines HARNESS_* and optional wrapper) ────────────────
# shellcheck disable=SC1090
source "$PROFILE_FILE"
: "${HARNESS_CMD:?profile must set HARNESS_CMD}"

# ── Stage the harness config (settings.json deny-list, models.json, etc.) ────
if [ -n "${HARNESS_CONFIG_SRC:-}" ] && [ -d "$SANDBOX_DIR/$HARNESS_CONFIG_SRC" ]; then
  mkdir -p "${HARNESS_CONFIG_DST:?profile must set HARNESS_CONFIG_DST}"
  cp -r "$SANDBOX_DIR/$HARNESS_CONFIG_SRC/." "$HARNESS_CONFIG_DST/"
  echo "  ✓ staged ${HARNESS_PROFILE_NAME:-$SANDBOX_PROFILE} config → $HARNESS_CONFIG_DST"
fi

cd "$SANDBOX_WORKDIR" 2>/dev/null || cd "${HOME:-/}"

echo "── agent phase: profile=$SANDBOX_PROFILE  cmd=${SANDBOX_RUN_WRAPPER:+$SANDBOX_RUN_WRAPPER }$HARNESS_CMD ${HARNESS_ARGS:-}"
_audit agent.start "cmd=$HARNESS_CMD wrapper=${SANDBOX_RUN_WRAPPER:-none}"

# SANDBOX_RUN_WRAPPER (optional) is the inner filesystem-confinement belt, e.g.
# Anthropic's sandbox-runtime. Profiles that need it (Pi has no permission system)
# set it; others leave it empty. word-split intentionally so a multi-word wrapper works.
# shellcheck disable=SC2086
exec ${SANDBOX_RUN_WRAPPER:-} "$HARNESS_CMD" ${HARNESS_ARGS:-}
