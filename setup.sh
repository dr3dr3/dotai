#!/usr/bin/env bash
# =============================================================================
# dotai — setup.sh
# =============================================================================
# Installs on a Debian/Ubuntu devcontainer or developer machine:
#   - Claude Code CLI    (via the official Anthropic install script)
#   - GitHub CLI (gh)    (gh auth, gh pr, and git workflows)
#   - Claude Code skills (skill-creator, and others from anthropics/skills)
#
# Run once from inside the devcontainer terminal:
#   bash /workspace/.ai/dotai/setup.sh
#
# Or from within the repo directory:
#   bash setup.sh
#
# After install, authenticate with:
#   claude auth login
# =============================================================================

set -euo pipefail

# -----------------------------------------------------------------------------
# 1.  Claude Code CLI
#     Official install: https://code.claude.com/docs/en/overview
# -----------------------------------------------------------------------------
if command -v claude &>/dev/null; then
    echo "✓ Claude Code $(claude --version 2>/dev/null | head -1) already installed — skipping."
else
    echo "→ Installing Claude Code CLI..."

    # Install dependencies
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends \
        ca-certificates \
        curl

    # Official Anthropic installer (handles Node.js, Claude Code, and PATH setup)
    curl -fsSL https://claude.ai/install.sh | bash

    echo "✓ Claude Code installed"
fi

# -----------------------------------------------------------------------------
# 2.  GitHub CLI (gh)
#     Used for: gh pr create, gh auth, git workflows
# -----------------------------------------------------------------------------
if command -v gh &>/dev/null; then
    echo "✓ gh $(gh --version | head -1) already installed — skipping."
else
    echo "→ Installing GitHub CLI (gh)..."

    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        gnupg

    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
    sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg

    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] \
https://cli.github.com/packages stable main" \
        | sudo tee /etc/apt/sources.list.d/github-cli.list

    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends gh

    sudo rm -rf /var/lib/apt/lists/*

    echo "✓ Installed $(gh --version | head -1)"
fi

# -----------------------------------------------------------------------------
# 3.  Claude Code skills
#     Skills live in ~/.claude/skills/ (personal, applies everywhere)
#     Source: https://github.com/anthropics/skills
# -----------------------------------------------------------------------------
SKILLS_DIR="$HOME/.claude/skills"
SKILLS_REPO="https://github.com/anthropics/skills.git"
SKILLS_TMP="$(mktemp -d)"

# Skills to install — add/remove as needed
SKILLS_TO_INSTALL=(
    "skill-creator"
)

echo "→ Installing Claude Code skills..."

# Clone the skills repo into a temp dir
git clone --depth 1 --quiet "$SKILLS_REPO" "$SKILLS_TMP"

mkdir -p "$SKILLS_DIR"

for skill in "${SKILLS_TO_INSTALL[@]}"; do
    src="$SKILLS_TMP/skills/$skill"
    dest="$SKILLS_DIR/$skill"
    if [ -d "$src" ]; then
        rm -rf "$dest"
        cp -r "$src" "$dest"
        echo "✓ Installed skill: $skill"
    else
        echo "⚠ Skill not found in repo: $skill (skipped)"
    fi
done

rm -rf "$SKILLS_TMP"
echo "✓ Skills installed to $SKILLS_DIR"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo ""
echo "✅ Tool installation complete."
echo ""
echo "Next steps:"
echo "  1. Authenticate with Claude: claude auth login"
echo "  2. Authenticate with GitHub:  gh auth login"
echo "  3. Wire context and commands:  bash scripts/setup.sh"
echo ""
echo "  Installed skills (invoke inside Claude Code):"
echo "    /skill-creator   — create, eval, and benchmark custom skills"
echo ""
echo "  Usage:"
echo "    claude           — start an interactive Claude Code session"
echo "    claude -p        — one-shot print mode"
echo "    claude update    — update Claude Code to the latest version"
