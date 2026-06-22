#!/usr/bin/env bash
# =============================================================================
# mempalace — personal trial setup (André)
# =============================================================================
# Idempotent installer for MemPalace (https://github.com/MemPalace/mempalace),
# an open-source local-first AI memory system. PERSONAL — lives under
# /workspace/.ai/dotai (gitignored, never committed to local-dev-env).
#
# Run after a devcontainer rebuild (home + uv tools are per-container; the
# palace DATA persists because it lives under /workspace via the symlink):
#
#   bash /workspace/.ai/dotai/mempalace/setup.sh
#
# Then finish the Claude Code wiring IN a Claude Code session (see end / README).
# =============================================================================
set -euo pipefail

BASE="/workspace/.ai/dotai/mempalace"
STATE="$BASE/state"            # persistent palace + config (host bind, survives rebuilds)

echo "→ MemPalace personal setup"

# 1. Persistence symlink: ~/.mempalace -> dotai/mempalace/state ------------------
#    mempalace reads config + palace from ~/.mempalace; pointing it at the host
#    bind makes everything survive devcontainer rebuilds and keeps it personal.
mkdir -p "$STATE"
if [ -e "$HOME/.mempalace" ] && [ ! -L "$HOME/.mempalace" ]; then
    echo "  • backing up existing real ~/.mempalace -> ~/.mempalace.bak"
    mv "$HOME/.mempalace" "$HOME/.mempalace.bak"
fi
ln -sfn "$STATE" "$HOME/.mempalace"
echo "  • ~/.mempalace -> $(readlink -f "$HOME/.mempalace")"

# 2. Pin the embedding model (English MiniLM — light, no model picker prompt) ----
#    minilm = all-MiniLM-L6-v2 (English). Alternative: "embeddinggemma" (multi-
#    lingual, larger). Switching later requires a re-embed of the whole palace.
if [ ! -f "$STATE/config.json" ]; then
    printf '{\n  "embedding_model": "minilm"\n}\n' > "$STATE/config.json"
    echo "  • wrote config.json (embedding_model=minilm)"
else
    echo "  • config.json already present — leaving as-is"
fi

# 3. Install the mempalace CLI + MCP server in an isolated env ------------------
#    uv tool keeps chromadb/numpy/grpcio off the system Python (PEP 668 safe).
if command -v mempalace >/dev/null 2>&1; then
    echo "  • mempalace $(mempalace --version 2>/dev/null | grep -o '[0-9.]*' | head -1) already installed"
else
    echo "  • installing mempalace via uv tool…"
    uv tool install mempalace
fi
echo "  • binaries: $(command -v mempalace) , $(command -v mempalace-mcp)"

# 4. Install the Claude Code plugin (MCP server + Stop/PreCompact hooks + skills) -
#    Claude Code runs as the VS Code extension here, so `claude` isn't on PATH —
#    but the extension bundles a usable binary. Resolve the newest one. (Falls
#    back to a PATH `claude` if you ever install the standalone CLI.)
#    This writes to ~/.claude (container home), so it must re-run after a rebuild.
CLAUDE_BIN="$(ls -d "$HOME"/.vscode-server/extensions/anthropic.claude-code-*/resources/native-binary/claude 2>/dev/null | sort -V | tail -1)"
if [ -z "${CLAUDE_BIN:-}" ] && command -v claude >/dev/null 2>&1; then CLAUDE_BIN="$(command -v claude)"; fi

if [ -z "${CLAUDE_BIN:-}" ]; then
    echo "  ⚠ no 'claude' binary found — install the plugin manually in a session:"
    echo "      /plugin marketplace add MemPalace/mempalace"
    echo "      /plugin install mempalace@mempalace"
elif "$CLAUDE_BIN" plugin list 2>/dev/null | grep -q 'mempalace@mempalace'; then
    echo "  • Claude Code plugin already installed — skipping"
else
    echo "  • installing Claude Code plugin via $CLAUDE_BIN"
    "$CLAUDE_BIN" plugin marketplace add MemPalace/mempalace 2>&1 | tail -2 || true
    "$CLAUDE_BIN" plugin install mempalace@mempalace 2>&1 | tail -2
fi

cat <<'EOF'

✅ Setup done. Reload the VS Code window so the MCP server + Stop/PreCompact
   hooks load into your running session.

Seed the palace (downloads the ~300MB MiniLM model on first run):

        bash /workspace/.ai/dotai/mempalace/seed.sh

Verify:  mempalace status   |   mempalace search "BootstrapTenant"   |   mempalace wake-up
EOF
