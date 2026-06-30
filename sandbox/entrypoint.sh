#!/usr/bin/env bash
# =============================================================================
# AI Sandbox — entrypoint (PID 1)
# =============================================================================
# Orchestrates the two-phase model and enforces the SETUP→AGENT boundary.
#
#   00-secrets  resolve secrets into THIS shell's environment (local vs fargate)
#   10-setup    clone repos (RO), install, build Graphify  — HAS full secrets
#   ── boundary: exec env -i with a curated allowlist ──
#   20-agent    exec the harness                            — RO tokens only
#
# Write-capable secrets live ONLY in this process's environment and the setup
# subshell. They are never placed in the agent process's environment: the agent is
# exec'd via `env -i`, inheriting only an explicit allowlist of variables plus the
# read-only integration tokens that 10-setup wrote to a tmpfs file.
# =============================================================================
set -euo pipefail

SANDBOX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SANDBOX_DIR

# ── Defaults (overridable by the runtime: compose env / ECS task def) ────────
export SANDBOX_ENV="${SANDBOX_ENV:-local}"          # local | fargate
export SANDBOX_PROFILE="${SANDBOX_PROFILE:-claude-code}"
export SANDBOX_WORKDIR="${SANDBOX_WORKDIR:-/work/roe-codebase}"
export SANDBOX_GRAPH_DIR="${SANDBOX_GRAPH_DIR:-/work/.graph}"
export SANDBOX_AUDIT_GROUP="${SANDBOX_AUDIT_GROUP:-/roe/sandbox/audit}"
export SANDBOX_AUDIT_FILE="${SANDBOX_AUDIT_FILE:-/var/log/sandbox/audit.jsonl}"
export AWS_REGION="${AWS_REGION:-ap-southeast-2}"

# A run id correlates every audit record from this sandbox instance. Derive a
# stable-ish one without Math.random/Date in JS land — shell is fine here.
export SANDBOX_RUN_ID="${SANDBOX_RUN_ID:-$(date +%Y%m%dT%H%M%SZ)-$$}"

# Read-only tokens that cross the boundary are written here by 10-setup, on tmpfs.
RO_TOKENS_FILE="${SANDBOX_RO_TOKENS:-/run/sandbox/ro-tokens.env}"
export SANDBOX_RO_TOKENS="$RO_TOKENS_FILE"

# That dir is a root-owned mount (tmpfs locally, an ephemeral task volume on
# Fargate), but this entrypoint runs as the non-root sandbox user — so take
# ownership up front or 10-setup can't write the RO-tokens file. sudo is image-
# granted (NOPASSWD) and used only here in the privileged setup stage, before the
# `env -i` boundary; the locked-down agent phase never gets it.
RO_TOKENS_DIR="$(dirname "$RO_TOKENS_FILE")"
if [ ! -w "$RO_TOKENS_DIR" ]; then
  sudo mkdir -p "$RO_TOKENS_DIR" \
    && sudo chown "$(id -u):$(id -g)" "$RO_TOKENS_DIR" \
    && sudo chmod 0700 "$RO_TOKENS_DIR"
fi

_audit() { node "$SANDBOX_DIR/lib/audit.mjs" "$@" || true; }

echo "── AI Sandbox ─ run=$SANDBOX_RUN_ID env=$SANDBOX_ENV profile=$SANDBOX_PROFILE"
_audit sandbox.start

# ── Phase 0: secrets into this shell ─────────────────────────────────────────
# shellcheck source=phases/00-secrets.sh
source "$SANDBOX_DIR/phases/00-secrets.sh"

# ── Phase 1: setup (full secrets, network) ───────────────────────────────────
_audit setup.start
"$SANDBOX_DIR/phases/10-setup.sh"
_audit setup.done

# ── Boundary: exec the agent phase with a curated, reduced environment ───────
# Build the allowlist explicitly. NOTHING else crosses. Note we deliberately do
# NOT pass: GITHUB_TOKEN/SSH_AUTH_SOCK/op:// resolution, registry tokens, or any
# write credential — those stay behind in the setup subshell.
echo "── boundary: dropping write-capable secrets, entering agent phase"
_audit boundary.cross

declare -a AGENT_ENV=(
  "PATH=$PATH"
  "HOME=${HOME:-/home/dev}"
  "USER=${USER:-dev}"
  "LANG=${LANG:-C.UTF-8}"
  "HTTP_PROXY=${HTTP_PROXY:-}"  "HTTPS_PROXY=${HTTPS_PROXY:-}"  "NO_PROXY=${NO_PROXY:-}"
  "http_proxy=${HTTP_PROXY:-}"  "https_proxy=${HTTPS_PROXY:-}"  "no_proxy=${NO_PROXY:-}"
  "SANDBOX_DIR=$SANDBOX_DIR"
  "SANDBOX_ENV=$SANDBOX_ENV"
  "SANDBOX_PROFILE=$SANDBOX_PROFILE"
  "SANDBOX_WORKDIR=$SANDBOX_WORKDIR"
  "SANDBOX_GRAPH_DIR=$SANDBOX_GRAPH_DIR"
  "SANDBOX_RO_TOKENS=$SANDBOX_RO_TOKENS"
  "SANDBOX_AUDIT_GROUP=$SANDBOX_AUDIT_GROUP"
  "SANDBOX_AUDIT_FILE=$SANDBOX_AUDIT_FILE"
  "SANDBOX_RUN_ID=$SANDBOX_RUN_ID"
  "SANDBOX_OPERATOR=${SANDBOX_OPERATOR:-}"
  "AWS_REGION=$AWS_REGION"
)

# Preserve the Fargate task-role credential endpoint so audit.mjs can reach
# CloudWatch in the agent phase. This is the READ-ONLY task role (see deploy/iam),
# not a secret — intentionally allowed across the boundary.
[ -n "${AWS_CONTAINER_CREDENTIALS_RELATIVE_URI:-}" ] && \
  AGENT_ENV+=("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI=$AWS_CONTAINER_CREDENTIALS_RELATIVE_URI")
[ -n "${AWS_CONTAINER_CREDENTIALS_FULL_URI:-}" ] && \
  AGENT_ENV+=("AWS_CONTAINER_CREDENTIALS_FULL_URI=$AWS_CONTAINER_CREDENTIALS_FULL_URI")

exec env -i "${AGENT_ENV[@]}" bash "$SANDBOX_DIR/phases/20-agent.sh"
