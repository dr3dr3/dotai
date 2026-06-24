#!/usr/bin/env bash
# =============================================================================
# Phase 1 — SETUP. Runs with full secrets + (allowlisted) network.
# =============================================================================
# Produces durable artifacts for the agent phase:
#   - codebase cloned READ-ONLY under $SANDBOX_WORKDIR (per repos.yaml)
#   - a Graphify knowledge graph at $SANDBOX_GRAPH_DIR
#   - $SANDBOX_RO_TOKENS : a tmpfs file holding ONLY read-only integration tokens,
#     which is the sole secret material that crosses into the agent phase.
#
# Everything secret used here (GITHUB_TOKEN for private clones, registry tokens,
# Graphify build creds) stays in this subshell and is dropped at the boundary.
# =============================================================================
set -euo pipefail

REPOS_YAML="${SANDBOX_REPOS_YAML:-$SANDBOX_DIR/repos.yaml}"
_audit() { node "$SANDBOX_DIR/lib/audit.mjs" "$@" || true; }

mkdir -p "$SANDBOX_WORKDIR" "$SANDBOX_GRAPH_DIR"

# ── 1. Clone the codebase(s), read-only ──────────────────────────────────────
# Private repos authenticate via GITHUB_TOKEN (setup-only). We inject it as an
# ephemeral http header so the token is never written into .git/config.
clone_count=0
if [ -f "$REPOS_YAML" ] && command -v yq >/dev/null 2>&1; then
  n="$(yq '.repos | length' "$REPOS_YAML" 2>/dev/null || echo 0)"
  for i in $(seq 0 $(( n - 1 )) 2>/dev/null || true); do
    url="$(yq -r ".repos[$i].url // \"\"" "$REPOS_YAML")"
    dir="$(yq -r ".repos[$i].dir // \"\"" "$REPOS_YAML")"
    ref="$(yq -r ".repos[$i].ref // \"\"" "$REPOS_YAML")"
    depth="$(yq -r ".repos[$i].depth // 1" "$REPOS_YAML")"
    [ -z "$url" ] || [ -z "$dir" ] && continue

    dest="$SANDBOX_WORKDIR/$dir"
    echo "  → cloning $url → roe-codebase/$dir (ref=${ref:-HEAD} depth=$depth)"

    auth_args=()
    if [ -n "${GITHUB_TOKEN:-}" ] && [[ "$url" == https://github.com/* ]]; then
      auth_args=(-c "http.https://github.com/.extraheader=Authorization: Bearer ${GITHUB_TOKEN}")
    fi
    depth_args=(); [ "$depth" != "0" ] && depth_args=(--depth "$depth")

    rm -rf "$dest"
    git "${auth_args[@]}" clone "${depth_args[@]}" "$url" "$dest" 2>&1 | sed 's/^/    /'
    [ -n "$ref" ] && git -C "$dest" checkout --quiet "$ref"

    # Make the working tree read-only: this is reference context, not a tree the
    # agent commits/pushes from. Belt to the no-push-creds suspenders.
    chmod -R a-w "$dest" 2>/dev/null || true
    clone_count=$(( clone_count + 1 ))
  done
else
  echo "  ⚠ no repos.yaml or yq — skipping clone (graph will be empty)"
fi
_audit setup.clone "repos=$clone_count"

# ── 2. Build the Graphify knowledge graph ────────────────────────────────────
# Graphify (github.com/safishamsi/graphify) turns the codebase + docs into a
# queryable graph the harness uses as cheap context (~70x fewer tokens than
# re-reading files). It parses locally via tree-sitter; the semantic-enrichment step
# may call the model API (allowlisted).
#
# The exact CLI is pinned via SANDBOX_GRAPH_CMD so it can be corrected without editing
# this script — confirm the invocation against the Graphify version you install. The
# command receives "$SANDBOX_WORKDIR" "$SANDBOX_GRAPH_DIR" as $1 $2. A build failure is
# non-fatal: the agent phase still runs, just without the graph.
GRAPH_CMD="${SANDBOX_GRAPH_CMD:-npx --yes graphify build \"\$1\" --output \"\$2\"}"
if [ "$clone_count" -gt 0 ] && [ "${SANDBOX_GRAPH_DISABLE:-0}" != "1" ]; then
  echo "  → building Graphify graph → ${SANDBOX_GRAPH_DIR}"
  if bash -c "$GRAPH_CMD" _ "$SANDBOX_WORKDIR" "$SANDBOX_GRAPH_DIR" 2>&1 | sed 's/^/    /'; then
    _audit setup.graph "status=ok"
  else
    echo "  ⚠ graphify build failed — agent phase will run without the graph"
    _audit setup.graph "status=failed"
  fi
else
  echo "  → skipping Graphify (nothing cloned or SANDBOX_GRAPH_DISABLE=1)"
fi

# ── 3. Hand only READ-ONLY tokens to the agent phase ─────────────────────────
# This file (tmpfs, 0600) is the ONLY secret material that crosses the boundary.
# We name each token explicitly — never `env | grep`, which could leak a write
# credential. Anything not listed here is unavailable to the agent.
mkdir -p "$(dirname "$SANDBOX_RO_TOKENS")"
: > "$SANDBOX_RO_TOKENS"
chmod 600 "$SANDBOX_RO_TOKENS"

emit_ro() {  # emit_ro VAR_NAME
  local name="$1"
  if [ -n "${!name:-}" ]; then
    printf '%s=%s\n' "$name" "${!name}" >> "$SANDBOX_RO_TOKENS"
    echo "  ✓ RO token available to agent: $name"
  fi
}
emit_ro SENTRY_TOKEN        # scope: project:read, event:read
emit_ro LINEAR_TOKEN        # RO-by-convention (see profiles/README — known caveat)
emit_ro SLACK_TOKEN         # scope: channels:history, search:read (NO chat:write)
emit_ro AGENTMAIL_API_KEY   # the ONE sanctioned write-channel (agent-email guardrails)

_audit setup.ro_tokens "file=$SANDBOX_RO_TOKENS"
echo "  ✓ setup complete"
