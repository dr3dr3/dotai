#!/usr/bin/env bash
# dotfiles owns the binary and shell integration; dotai owns agent hooks.
set -euo pipefail
export PATH="$HOME/.local/bin:$HOME/.atuin/bin:$PATH"

if ! command -v atuin >/dev/null 2>&1; then
  echo "Atuin hooks skipped: install Atuin with dotfiles/scripts/setup-atuin.sh, then rerun this script."
  exit 0
fi

# Native installation merges with existing hooks and skips duplicate entries.
# Register both even when an agent binary is not on this shell's PATH yet.
atuin hook install claude-code
atuin hook install codex
echo "Atuin agent hooks ready. Restart Claude/Codex; review new Codex hooks with /hooks."
