#!/usr/bin/env bash
# dotai — setup script
# Wires context docs and slash commands into Claude Code (and optionally Cursor/Windsurf).
# Run this once after cloning a repo, or let the devcontainer's postCreateCommand invoke it.

set -euo pipefail

# ── Resolve paths ────────────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVEX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="${PWD}"

echo ""
echo "dotai — Setup"
echo "=============="
echo "dotai dir  : $DEVEX_DIR"
echo "Target repo: $REPO_DIR"
echo ""

# ── Claude Code ───────────────────────────────────────────────────────────────

CLAUDE_DIR="$HOME/.claude"
CLAUDE_COMMANDS_DIR="$CLAUDE_DIR/commands"

mkdir -p "$CLAUDE_COMMANDS_DIR"

echo ""
echo "→ Linking slash commands into ~/.claude/commands/"
# Commands are invoked as /command-name in a Claude Code session
# We symlink so updates to this repo are reflected immediately
for f in "$DEVEX_DIR/commands/"*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "$CLAUDE_COMMANDS_DIR/$name"
  echo "  ✓ /$(basename "$name" .md)"
done

# ── Claude Code skills ───────────────────────────────────────────────────────
# Symlink each skill dir (one containing a SKILL.md) into ~/.claude/skills/ so
# updates here are picked up immediately. Personal collection — applies
# everywhere this user runs Claude Code.

CLAUDE_SKILLS_DIR="$CLAUDE_DIR/skills"
mkdir -p "$CLAUDE_SKILLS_DIR"

echo ""
echo "→ Linking skills into ~/.claude/skills/"
for d in "$DEVEX_DIR/skills/"*/; do
  [ -f "${d}SKILL.md" ] || continue
  name="$(basename "$d")"
  ln -sfn "${d%/}" "$CLAUDE_SKILLS_DIR/$name"
  echo "  ✓ $name"
done

# ── Global ~/.claude/CLAUDE.md ───────────────────────────────────────────────

GLOBAL_CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

if [ ! -f "$GLOBAL_CLAUDE_MD" ]; then
  echo ""
  echo "→ Creating ~/.claude/CLAUDE.md (user-level global context)"
  cat > "$GLOBAL_CLAUDE_MD" << 'EOF'
# Global Claude Context

# Import context docs from your repo's CLAUDE.md.
# Each repo's CLAUDE.md should contain the context relevant to that codebase.
EOF
  echo "  ✓ ~/.claude/CLAUDE.md created"
else
  echo ""
  echo "→ ~/.claude/CLAUDE.md already exists — leaving it unchanged"
fi

# ── Global ~/.claude/settings.json — ccstatusline ────────────────────────────

GLOBAL_SETTINGS="$CLAUDE_DIR/settings.json"

echo ""
echo "→ Configuring ccstatusline in ~/.claude/settings.json"

if [ ! -f "$GLOBAL_SETTINGS" ]; then
  printf '{\n  "statusLine": {\n    "type": "command",\n    "command": "npx -y ccstatusline@latest",\n    "padding": 0\n  }\n}\n' > "$GLOBAL_SETTINGS"
  echo "  ✓ ~/.claude/settings.json created with ccstatusline statusLine"
else
  python3 - "$GLOBAL_SETTINGS" <<'PYEOF'
import json, sys
path = sys.argv[1]
with open(path) as f:
    data = json.load(f)
if "statusLine" not in data:
    data["statusLine"] = {"type": "command", "command": "npx -y ccstatusline@latest", "padding": 0}
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    print("  ✓ statusLine added to ~/.claude/settings.json")
else:
    print("  → statusLine already configured — leaving it unchanged")
PYEOF
fi

# ── Repo CLAUDE.md ────────────────────────────────────────────────────────────

if [ ! -f "$REPO_DIR/CLAUDE.md" ]; then
  echo ""
  echo "→ No CLAUDE.md found in repo — copying template"
  cp "$DEVEX_DIR/templates/CLAUDE.md" "$REPO_DIR/CLAUDE.md"
  echo "  ✓ CLAUDE.md created from template (fill in the repo-specific sections)"
else
  echo ""
  echo "→ CLAUDE.md already exists in repo — leaving it unchanged"
fi

# ── Repo .claude/settings.json ──────────────────────────────────────────────

CLAUDE_SETTINGS_DIR="$REPO_DIR/.claude"
CLAUDE_SETTINGS_FILE="$CLAUDE_SETTINGS_DIR/settings.json"

if [ ! -f "$CLAUDE_SETTINGS_FILE" ] && [ -f "$DEVEX_DIR/templates/settings.json" ]; then
  echo ""
  echo "→ No .claude/settings.json found — copying template"
  mkdir -p "$CLAUDE_SETTINGS_DIR"
  cp "$DEVEX_DIR/templates/settings.json" "$CLAUDE_SETTINGS_FILE"
  echo "  ✓ .claude/settings.json created from template (review and adjust permissions)"
elif [ -f "$CLAUDE_SETTINGS_FILE" ]; then
  echo ""
  echo "→ .claude/settings.json already exists — leaving it unchanged"
fi

# ── Claude Code CLI ───────────────────────────────────────────────────────────
# Personal setup — install the Claude Code CLI if it's missing so the plugin
# registration below (guarded by `command -v claude`) actually runs instead of
# silently skipping. This lives in dotai, not the shared devcontainer/ai-devex.
if ! command -v claude &>/dev/null; then
  if command -v npm &>/dev/null; then
    echo ""
    echo "→ Installing Claude Code CLI (npm -g @anthropic-ai/claude-code)"
    # --allow-scripts runs the package postinstall (install.cjs) that npm's
    # allow-scripts gating otherwise blocks.
    if npm install -g --allow-scripts=@anthropic-ai/claude-code @anthropic-ai/claude-code; then
      echo "  ✓ Claude Code installed: $(claude --version 2>/dev/null || echo 'check PATH')"
    else
      echo "  ⚠ Claude Code install failed — install manually: npm install -g @anthropic-ai/claude-code"
    fi
  else
    echo ""
    echo "⚠ npm not found — cannot install Claude Code CLI"
  fi
fi

# ── Linear personal token from 1Password (personal dotai) ──────────────────────
# Resolve my personal Linear API key from 1Password so BOTH the Linear CLI and
# the key-based `linear` MCP (registered below) come up authenticated without
# pasting keys. Pinned to my personal account + "Rock of Eye" vault; the key is
# the secure-note body (field notesPlain). Gracefully skips if op can't resolve
# it (not signed in / no agent.sock in this context), so a run never hard-fails.
LINEAR_OP_ACCOUNT="my.1password.com"
LINEAR_OP_REF="op://Rock of Eye/Linear API Key/notesPlain"
if [ -z "${LINEAR_ACCESS_TOKEN:-}" ] && command -v op &>/dev/null; then
  echo ""
  echo "→ Resolving Linear API key from 1Password ($LINEAR_OP_REF)"
  if _linear_tok="$(op read --account "$LINEAR_OP_ACCOUNT" "$LINEAR_OP_REF" 2>/dev/null)" \
     && [ -n "$_linear_tok" ]; then
    export LINEAR_ACCESS_TOKEN="$_linear_tok"
    export LINEAR_API_KEY="${LINEAR_API_KEY:-$_linear_tok}"  # env name used by the CLI / skills
    unset _linear_tok
    echo "  ✓ Linear key resolved from 1Password"
  else
    echo "  ⚠ Could not resolve Linear key from 1Password (op not signed in / no agent.sock?) — skipping"
  fi
fi

# Authenticate the Linear CLI with that key. --plaintext writes to ~/.config/linear
# (on the persisted volume, survives rebuilds); the headless container has no keyring.
if [ -n "${LINEAR_ACCESS_TOKEN:-}" ] && command -v linear &>/dev/null; then
  if linear auth token &>/dev/null; then
    echo "  ✓ Linear CLI already authenticated"
  elif linear auth login --plaintext --key "$LINEAR_ACCESS_TOKEN" &>/dev/null; then
    echo "  ✓ Linear CLI authenticated (key from 1Password)"
  else
    echo "  ⚠ Linear CLI login failed"
  fi
fi

# ── Claude Code Plugins ───────────────────────────────────────────────────────

if command -v claude &>/dev/null; then
  echo ""
  echo "→ Registering Claude Code plugins"

  # Helper: register an MCP server scoped to the user; skips if already present
  _mcp_add() {
    local name="$1"; shift
    if claude mcp get "$name" &>/dev/null 2>&1; then
      echo "  → $name already registered — skipping"
    else
      claude mcp add --scope user "$name" -- "$@" \
        && echo "  ✓ $name" \
        || echo "  ✗ $name — registration failed (verify package name)"
    fi
  }

  # Superpowers — TDD, debugging, and collaboration workflow skills
  _mcp_add superpowers          npx -y superpowers-mcp

  # Context7 — pulls up-to-date library docs into context
  _mcp_add context7             npx -y @upstash/context7-mcp@latest

  # Code-reviewer — AI-powered code review via MCP
  _mcp_add code-reviewer        npx -y code-review-mcp

  # PR review toolkit — GraphQL-based GitHub PR review
  _mcp_add pr-review-toolkit    npx -y pr-review-mcp

  # Linear — issue and project management via Linear API
  # Requires LINEAR_ACCESS_TOKEN (Personal Access Token from linear.app/settings/api)
  if [ -n "${LINEAR_ACCESS_TOKEN:-}" ]; then
    _mcp_add linear             -e "LINEAR_ACCESS_TOKEN=$LINEAR_ACCESS_TOKEN" -- npx -y linear-mcp
  else
    echo "  ⚠ linear — skipped (set LINEAR_ACCESS_TOKEN and re-run to register)"
  fi

  # Code-simplifier and Claude-md-management are native Claude Code plugins.
  # They require a marketplace to be configured before installation.
  # Add a marketplace with: claude plugin marketplace add <url-or-github-repo>
  # Then uncomment the lines below:
  #   claude plugin install --scope user code-simplifier
  #   claude plugin install --scope user claude-md-management

else
  echo ""
  echo "⚠ Claude Code not found — skipping plugin registration"
  echo "  Install Claude Code and re-run this script to register plugins"
fi

# ── Cursor / Windsurf ────────────────────────────────────────────────────────

CURSOR_RULES="$REPO_DIR/.cursorrules"
WINDSURF_RULES="$REPO_DIR/.windsurfrules"

if [ ! -f "$CURSOR_RULES" ] && command -v cursor &>/dev/null; then
  echo ""
  echo "→ Cursor detected — symlinking context into .cursorrules"
  ln -sf "$DEVEX_DIR/templates/CLAUDE.md" "$CURSOR_RULES"
  echo "  ✓ .cursorrules linked (points to CLAUDE.md template)"
fi

if [ ! -f "$WINDSURF_RULES" ] && command -v windsurf &>/dev/null; then
  echo ""
  echo "→ Windsurf detected — symlinking context into .windsurfrules"
  ln -sf "$DEVEX_DIR/templates/AGENT.md" "$WINDSURF_RULES"
  echo "  ✓ .windsurfrules linked (points to AGENT.md template)"
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "✅ Setup complete."
echo ""
echo "Next steps:"
if [ -f "$REPO_DIR/CLAUDE.md" ] && grep -q "\[REPO NAME\]" "$REPO_DIR/CLAUDE.md" 2>/dev/null; then
  echo "  1. Open CLAUDE.md and fill in the repo-specific sections (search for [REPO NAME])"
fi
echo "  • Slash commands in Claude Code: /pr-summary, /review, /test, /adr"
echo "  • MCP plugins registered:        superpowers, context7, code-reviewer, pr-review-toolkit, linear"
echo "  • Marketplace plugins:           configure a marketplace to install code-simplifier + claude-md-management"
echo "  • Start a session:               claude"
echo ""
