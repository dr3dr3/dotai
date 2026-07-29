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

# ── ~/.claude/settings.json — merge permissions from template ────────────────

SETTINGS_TEMPLATE="$DEVEX_DIR/templates/settings.json"

echo ""
echo "→ Merging permissions into ~/.claude/settings.json"

if [ -f "$SETTINGS_TEMPLATE" ]; then
  python3 - "$GLOBAL_SETTINGS" "$SETTINGS_TEMPLATE" <<'PYEOF'
import json, sys

settings_path = sys.argv[1]
template_path = sys.argv[2]

with open(settings_path) as f:
    settings = json.load(f)

with open(template_path) as f:
    template = json.load(f)

# Merge permissions: union of allow/deny lists, preserving existing entries
tpl_perms = template.get("permissions", {})
cur_perms = settings.get("permissions", {})

for key in ("allow", "deny"):
    existing = set(cur_perms.get(key, []))
    incoming = set(tpl_perms.get(key, []))
    merged = sorted(existing | incoming)
    if merged:
        cur_perms[key] = merged

if cur_perms:
    settings["permissions"] = cur_perms

with open(settings_path, "w") as f:
    json.dump(settings, f, indent=2)
    f.write("\n")

print("  ✓ permissions merged into ~/.claude/settings.json")
PYEOF
else
  echo "  ⚠ No template found at $SETTINGS_TEMPLATE — skipping"
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

# Resolve claude binary — may not be on PATH when running under sudo
CLAUDE_BIN=""
if command -v claude &>/dev/null; then
  CLAUDE_BIN="claude"
elif [ -x "$HOME/.local/bin/claude" ]; then
  CLAUDE_BIN="$HOME/.local/bin/claude"
elif [ -n "${SUDO_USER:-}" ]; then
  _sudo_home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
  if [ -x "$_sudo_home/.local/bin/claude" ]; then
    CLAUDE_BIN="$_sudo_home/.local/bin/claude"
  fi
fi

if [ -n "$CLAUDE_BIN" ]; then
  echo ""
  echo "→ Registering Claude Code plugins (using $CLAUDE_BIN)"

  # Helper: register an MCP server scoped to the user; skips if already present
  _mcp_add() {
    local name="$1"; shift
    if "$CLAUDE_BIN" mcp get "$name" &>/dev/null 2>&1; then
      echo "  → $name already registered — skipping"
    else
      "$CLAUDE_BIN" mcp add --scope user "$name" -- "$@" \
        && echo "  ✓ $name" \
        || echo "  ✗ $name — registration failed (verify package name)"
    fi
  }

  # Helper: register a remote (HTTP) MCP server scoped to the user; skips if present.
  # Remote servers authenticate via OAuth rather than an env-var token — after
  # registration, run /mcp inside a Claude Code session to complete the browser flow.
  _mcp_add_http() {
    local name="$1"; local url="$2"
    if "$CLAUDE_BIN" mcp get "$name" &>/dev/null 2>&1; then
      echo "  → $name already registered — skipping"
    else
      "$CLAUDE_BIN" mcp add --transport http --scope user "$name" "$url" \
        && echo "  ✓ $name (remote — run /mcp to authenticate)" \
        || echo "  ✗ $name — registration failed"
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

  # Notion — official remote MCP (OAuth). AI read/write over Notion pages,
  # databases, and search. After registration, run /mcp in a Claude Code session
  # to authorise and choose which pages/teamspaces to expose.
  _mcp_add_http notion          https://mcp.notion.com/mcp

  # Helper: register a plugin marketplace (idempotent) then install a plugin at
  # user scope. Marketplace + install state live in ~/.claude (settings.json
  # `extraKnownMarketplaces` + the plugins cache) and are shared with the VS Code
  # extension, so a plugin added here also shows up under `/plugins` there.
  _plugin_add() {
    local plugin="$1"; local marketplace="$2"; local repo="$3"
    if "$CLAUDE_BIN" plugin marketplace list 2>/dev/null | grep -q "$marketplace"; then
      :
    else
      "$CLAUDE_BIN" plugin marketplace add "$repo" &>/dev/null \
        && echo "  ✓ marketplace $marketplace ($repo)" \
        || echo "  ✗ marketplace $marketplace — add failed ($repo)"
    fi
    if "$CLAUDE_BIN" plugin list 2>/dev/null | grep -q "$plugin"; then
      echo "  → $plugin already installed — skipping"
    else
      "$CLAUDE_BIN" plugin install "$plugin@$marketplace" --scope user &>/dev/null \
        && echo "  ✓ $plugin" \
        || echo "  ✗ $plugin — install failed (run: $CLAUDE_BIN plugin install $plugin@$marketplace)"
    fi
  }

  # Impeccable — design fluency for frontend work: 1 skill, 23 `/impeccable`
  # commands (polish, audit, critique, typeset, distill, document …) + curated
  # anti-pattern ("slop") detection, and the portable DESIGN.md format we author
  # our design systems in. https://impeccable.style
  _plugin_add impeccable impeccable pbakaus/impeccable

  # Code-simplifier and Claude-md-management are other native plugins you can add
  # the same way once their marketplaces are published, e.g.:
  #   _plugin_add code-simplifier <marketplace> <owner/repo>

else
  echo ""
  echo "⚠ Claude Code not found — skipping plugin registration"
  echo "  Install Claude Code (~/.local/bin/claude) and re-run this script to register plugins"
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
echo "  • MCP plugins registered:        superpowers, context7, code-reviewer, pr-review-toolkit, linear, notion"
echo "  • Marketplace plugins:           configure a marketplace to install code-simplifier + claude-md-management"
echo "  • Start a session:               claude"
echo ""
