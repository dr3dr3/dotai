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

# 2b. Install the L0 identity (who you are) used by `wake-up` -------------------
#     state/ is gitignored, so the committed template (identity.txt next to this
#     script) is copied in on first setup. `-n` never clobbers a local edit.
if [ -f "$BASE/identity.txt" ]; then
    cp -n "$BASE/identity.txt" "$STATE/identity.txt" 2>/dev/null || true
    echo "  • identity.txt installed (~/.mempalace/identity.txt)"
fi

# 3. Install the mempalace CLI + MCP server in an isolated env ------------------
#    uv tool keeps chromadb/numpy/grpcio off the system Python (PEP 668 safe).
#    The shared pgvector backend (Postgres on the always-on Windows PC, reached
#    via host.docker.internal locally / tailnet from the Mac) needs the
#    [pgvector] extra for psycopg. We pick the variant from config.json's backend
#    and --force so the right extras are present even if a plain install existed.
BACKEND="$(python3 -c "import json; print(json.load(open('$STATE/config.json')).get('backend','chroma'))" 2>/dev/null || echo chroma)"
if [ "$BACKEND" = "pgvector" ]; then PKG_SPEC='mempalace[pgvector]'; else PKG_SPEC='mempalace'; fi
echo "  • installing $PKG_SPEC via uv tool… (backend=$BACKEND)"
uv tool install "$PKG_SPEC" --force
echo "  • binaries: $(command -v mempalace) , $(command -v mempalace-mcp)"

# 3b. Strip NUL (0x00) bytes in the pgvector backend (upstream bug) -------------
#     Chroma tolerated NUL in drawer text; Postgres text/jsonb reject it, so
#     convo mining crashes without this. Idempotent; no-op when pgvector isn't
#     installed. Re-applied here because uv tool install above replaces vendored
#     files. Remove once fixed upstream (mempalace > 3.4.1).
if [ "$BACKEND" = "pgvector" ]; then
    uv tool run --from "$PKG_SPEC" python "$BASE/patch-pgvector-nul.py" \
        || echo "  ⚠ NUL patch failed — convo mining into pgvector may crash"
fi

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

# 5. Register the SessionStart wake-up hook ------------------------------------
#    The plugin ships Stop/PreCompact (auto-save) hooks but NOT a SessionStart
#    one, so palace recall isn't proactive by default. This wires
#    `mempalace hook run --hook session-start` into ~/.claude/settings.json so
#    ~600-900 tokens of palace context are injected at the start of every session
#    — rebuild-proof + cross-machine (the palace lives on the tailnet backend).
#    settings.json is container-home (wiped on rebuild), which is why this runs
#    here. Idempotent JSON merge: preserves any existing hooks (e.g. codegraph).
HOOK_SH="$BASE/hooks/session-start.sh"
chmod +x "$HOOK_SH" 2>/dev/null || true
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"
HOOK_CMD="bash $HOOK_SH" python3 - "$SETTINGS" <<'PY'
import json, os, sys
path = sys.argv[1]
cmd = os.environ["HOOK_CMD"]
try:
    with open(path) as f:
        cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    cfg = {}
hooks = cfg.setdefault("hooks", {})
ss = hooks.setdefault("SessionStart", [])
present = any(
    h.get("command") == cmd
    for group in ss if isinstance(group, dict)
    for h in group.get("hooks", []) if isinstance(h, dict)
)
if present:
    print("  • SessionStart wake-up hook already registered — skipping")
else:
    ss.append({"hooks": [{"type": "command", "command": cmd}]})
    with open(path, "w") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    print("  • registered MemPalace SessionStart wake-up hook in settings.json")
PY

cat <<'EOF'

✅ Setup done. Reload the VS Code window so the MCP server + Stop/PreCompact
   + SessionStart wake-up hooks load into your running session.

Seed the palace (downloads the ~300MB MiniLM model on first run):

        bash /workspace/.ai/dotai/mempalace/seed.sh

Verify:  mempalace status   |   mempalace search "BootstrapTenant"   |   mempalace wake-up
EOF
