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

# Personal state belongs to dotai; local-dev-env only supplies the volume.
python3 "$(dirname "${BASH_SOURCE[0]}")/scripts/persist-codex.py"

# Personal shortcuts are enabled only inside devcontainers.
python3 "$(dirname "${BASH_SOURCE[0]}")/scripts/setup-agent-aliases.py"

# A devcontainer rebuild keeps ~/.local (home volume) but wipes the image's
# global npm tree. The Firstmate sandbox launchers in ~/.local/bin survive and
# shadow the real binaries, so `command -v codex` answers "installed" while
# the executable behind the launcher is gone (2026-09-16 rebuild). Only treat
# an agent as installed when the resolved target exists and is not a launcher.
agent_installed() {
    local agent="$1" found target
    found="$(command -v "$agent" 2>/dev/null)" || return 1
    target="$(readlink -f "$found" 2>/dev/null)" || return 1
    if [[ "$(basename "$target")" == "firstmate-harness-sandbox.sh" ]]; then
        # PATH answers with the Firstmate launcher; the real binary is the
        # link setup-firstmate.sh keeps behind it, and that link is only
        # meaningful while it still resolves.
        target="$(readlink -f "$HOME/.local/lib/roe-firstmate/harnesses/$agent" 2>/dev/null)" || return 1
    fi
    [[ -x "$target" ]]
}

# -----------------------------------------------------------------------------
# 1.  Claude Code CLI
#     Official install: https://code.claude.com/docs/en/overview
# -----------------------------------------------------------------------------
if agent_installed claude; then
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
#
#     Codex and Pi are opt-in (DOTAI_INSTALL_CODEX=1 / DOTAI_INSTALL_PI=1):
#     the Firstmate pilot is pinned to Claude, and every extra agent in the
#     image's global npm tree is one more thing a rebuild silently removes.
# -----------------------------------------------------------------------------
if ! command -v npm &>/dev/null; then
    echo "⚠ npm not found — skipping Codex/varlock/Pi (install Node, then re-run)."
else
    # Codex CLI (OpenAI) — secondary agent, opt-in
    if [[ "${DOTAI_INSTALL_CODEX:-0}" != 1 ]]; then
        echo "  (Codex not requested — set DOTAI_INSTALL_CODEX=1 to install)"
    elif agent_installed codex; then
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

    # Pi Harness — self-extensible coding agent (earendil-works/pi), opt-in.
    # Installed with --ignore-scripts per the vendor docs (https://pi.dev/docs).
    # Pi has NO built-in permission system, so running it inside the container
    # is the intended sandbox. Model wiring (Vercel AI Gateway + host Ollama)
    # is done by scripts/setup-pi.py below.
    if [[ "${DOTAI_INSTALL_PI:-0}" != 1 ]]; then
        echo "  (Pi not requested — set DOTAI_INSTALL_PI=1 to install)"
    elif agent_installed pi; then
        echo "✓ Pi $(pi --version 2>/dev/null | head -1) already installed — skipping."
    else
        echo "→ Installing Pi Harness (@earendil-works/pi-coding-agent)..."
        npm install -g --ignore-scripts @earendil-works/pi-coding-agent \
            && echo "✓ Pi installed"
    fi

    # Persist ~/.pi/agent on the ~/.ai volume, merge the committed providers
    # (Vercel AI Gateway + the Ollama stub) into the live models.json, and store
    # the gateway key from 1Password in auth.json. The Ollama MODEL LIST is not
    # committed — generate it from the host's live API:
    #   python3 /workspace/.ai/dotai/scripts/pi-ollama-models.py
    if agent_installed pi; then
        PI_SETUP="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/scripts/setup-pi.py"
        python3 "$PI_SETUP" \
            || echo "⚠ Pi wiring failed (see above) — fix and re-run: python3 $PI_SETUP"
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

    # Registration table: script | hook event | tool matcher.
    # Add a row here when you add a hook to hooks/ — the copy loop above is
    # generic; only registration needs to know the event and matcher.
    python3 - "$HOME_SETTINGS" "$HOME_HOOKS_DIR" <<'REGPY'
import json, os, sys

settings, hooks_dir = sys.argv[1], sys.argv[2]

REGISTRY = [
    # (script name, hook event, tool matcher)
    ("guard-instance-docker.sh", "PreToolUse",  "Bash"),
    ("memory-index-budget.sh",   "PostToolUse", "Write|Edit|MultiEdit|NotebookEdit"),
]

data = {}
if os.path.exists(settings):
    with open(settings) as f:
        try: data = json.load(f)
        except Exception: data = {}

changed = False
for script, event, matcher in REGISTRY:
    cmd = os.path.join(hooks_dir, script)
    if not os.path.isfile(cmd):
        print("\u26a0 %s not installed \u2014 skipped registration" % script)
        continue
    bucket = data.setdefault("hooks", {}).setdefault(event, [])
    exists = any(h.get("command") == cmd for blk in bucket if isinstance(blk, dict)
                 for h in blk.get("hooks", []) if isinstance(h, dict))
    if exists:
        print("\u2713 %s already registered (%s)" % (script, event))
        continue
    bucket.append({"matcher": matcher, "hooks": [{"type": "command", "command": cmd}]})
    changed = True
    print("\u2713 registered %s in ~/.claude/settings.json (%s)" % (script, event))

if changed:
    os.makedirs(os.path.dirname(settings), exist_ok=True)
    with open(settings, "w") as f:
        json.dump(data, f, indent=2); f.write("\n")
REGPY
fi

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
bash "$(dirname "${BASH_SOURCE[0]}")/scripts/setup-atuin-hooks.sh" || echo "  ⚠ Atuin agent hooks not installed (see output above); setup continues"

echo ""
echo "✅ Tool installation complete."
echo ""
echo "Next steps:"
echo "  1. Authenticate with Claude: claude auth login"
echo "  2. Authenticate with GitHub:  gh auth login"
echo "  3. Authenticate with Codex:   codex login"
echo "  4. Wire context and commands:  bash scripts/setup.sh"
echo ""
echo "  Installed skills (invoke inside Claude Code):"
echo "    /skill-creator   — create, eval, and benchmark custom skills"
echo ""
echo "  Usage:"
echo "    claude           — start an interactive Claude Code session"
echo "    claude -p        — one-shot print mode"
echo "    claude update    — update Claude Code to the latest version"
