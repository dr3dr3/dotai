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
# 1b. Secondary agents + secrets tooling (Codex, varlock; Pi Harness optional)
#     These run *inside* the container so the host stays agent-free. Installed
#     via npm — the devcontainer ships Node 22; for other containers we guard.
# -----------------------------------------------------------------------------
if ! command -v npm &>/dev/null; then
    echo "⚠ npm not found — skipping Codex/varlock/Pi (install Node, then re-run)."
else
    # Codex CLI (OpenAI) — secondary agent
    if command -v codex &>/dev/null; then
        echo "✓ Codex $(codex --version 2>/dev/null | head -1) already installed — skipping."
    else
        echo "→ Installing Codex CLI (@openai/codex)..."
        npm install -g @openai/codex && echo "✓ Codex installed"
    fi

    # varlock — resolves op:// references into the env at agent launch time.
    # Pairs with the mounted 1Password agent.sock (see devcontainer.json).
    if command -v varlock &>/dev/null; then
        echo "✓ varlock $(varlock --version 2>/dev/null | head -1) already installed — skipping."
    else
        echo "→ Installing varlock..."
        npm install -g varlock && echo "✓ varlock installed"
    fi

    # Pi Harness — self-extensible coding agent (earendil-works/pi).
    # Installed with --ignore-scripts per the vendor docs (https://pi.dev/docs).
    # Pi has NO built-in permission system, so running it inside the container
    # is the intended sandbox. For local models, point it at the host Ollama via
    # ~/.config/pi/models.json (OpenAI-compatible endpoint host.docker.internal
    # :11434/v1) — see the cheat-sheet; cloud needs ANTHROPIC_API_KEY etc.
    if command -v pi &>/dev/null; then
        echo "✓ Pi $(pi --version 2>/dev/null | head -1) already installed — skipping."
    else
        echo "→ Installing Pi Harness (@earendil-works/pi-coding-agent)..."
        npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
            && echo "✓ Pi installed"
    fi
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
# 3b. Claude Code guard hooks (personal, ~/.claude — always-on for André)
#     Installs guard hooks into ~/.claude/hooks/ and registers them in
#     ~/.claude/settings.json. Home-level so they fire for ANY project root —
#     unlike the project-level copy ai-devex installs into a repo's .claude/,
#     which only fires when that repo is the open project. Canonical source of
#     each script is ai-devex/hooks/; dotai bundles a copy so personal setup is
#     self-contained. Idempotent — re-running never duplicates a registration.
# -----------------------------------------------------------------------------
HOOKS_SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hooks"
if [ -d "$HOOKS_SRC_DIR" ] && command -v python3 &>/dev/null; then
    HOME_HOOKS_DIR="$HOME/.claude/hooks"
    HOME_SETTINGS="$HOME/.claude/settings.json"
    mkdir -p "$HOME_HOOKS_DIR"

    echo "→ Installing personal guard hooks into ~/.claude/hooks/"
    for hook_src in "$HOOKS_SRC_DIR/"*.sh; do
        [ -f "$hook_src" ] || continue
        cp -f "$hook_src" "$HOME_HOOKS_DIR/$(basename "$hook_src")"
        chmod +x "$HOME_HOOKS_DIR/$(basename "$hook_src")"
        echo "✓ $(basename "$hook_src")"
    done

    if [ -f "$HOME_HOOKS_DIR/guard-instance-docker.sh" ]; then
        python3 - "$HOME_SETTINGS" "$HOME_HOOKS_DIR/guard-instance-docker.sh" <<'PY'
import json, os, sys
path, cmd = sys.argv[1], sys.argv[2]
data = {}
if os.path.exists(path):
    with open(path) as f:
        try: data = json.load(f)
        except Exception: data = {}
pre = data.setdefault("hooks", {}).setdefault("PreToolUse", [])
exists = any(h.get("command") == cmd for blk in pre if isinstance(blk, dict)
             for h in blk.get("hooks", []) if isinstance(h, dict))
if not exists:
    pre.append({"matcher": "Bash", "hooks": [{"type": "command", "command": cmd}]})
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(data, f, indent=2); f.write("\n")
    print("✓ registered guard-instance-docker.sh in ~/.claude/settings.json")
else:
    print("✓ guard-instance-docker.sh already registered (~/.claude)")
PY
    fi
fi

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
