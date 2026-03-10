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
CLAUDE_CONTEXT_DIR="$CLAUDE_DIR/context"
CLAUDE_COMMANDS_DIR="$CLAUDE_DIR/commands"

mkdir -p "$CLAUDE_CONTEXT_DIR" "$CLAUDE_COMMANDS_DIR"

echo "→ Linking context documents into ~/.claude/context/"
for f in "$DEVEX_DIR/context/"*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "$CLAUDE_CONTEXT_DIR/$name"
  echo "  ✓ $name"
done

echo ""
echo "→ Linking slash commands into ~/.claude/commands/"
# Commands are invoked as /command-name in a Claude Code session
# We symlink so updates to this repo are reflected immediately
for f in "$DEVEX_DIR/commands/"*.md; do
  name="$(basename "$f")"
  ln -sf "$f" "$CLAUDE_COMMANDS_DIR/$name"
  echo "  ✓ /$(basename "$name" .md)"
done

# ── Global ~/.claude/CLAUDE.md ───────────────────────────────────────────────

GLOBAL_CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"

if [ ! -f "$GLOBAL_CLAUDE_MD" ]; then
  echo ""
  echo "→ Creating ~/.claude/CLAUDE.md (user-level global context)"
  cat > "$GLOBAL_CLAUDE_MD" << 'EOF'
# Global Claude Context

@~/.claude/context/architecture.md
@~/.claude/context/domain-language.md
@~/.claude/context/engineering-standards.md
@~/.claude/context/testing-philosophy.md
@~/.claude/context/platform-context.md
EOF
  echo "  ✓ ~/.claude/CLAUDE.md created"
else
  echo ""
  echo "→ ~/.claude/CLAUDE.md already exists — leaving it unchanged"
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
echo "  • Shared context symlinked at:   ~/.claude/context/"
echo "  • Start a session:               claude"
echo ""
