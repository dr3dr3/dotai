#!/usr/bin/env bash
# dotai — update script
# Pulls the latest dotai changes and re-links everything.
# Run this periodically or after updates to this repo.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEVEX_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo "dotai — Update"
echo "==============="
echo "dotai dir: $DEVEX_DIR"
echo ""

# ── Pull latest ──────────────────────────────────────────────────────────────

echo "→ Pulling latest from origin/main"
git -C "$DEVEX_DIR" pull --ff-only origin main
echo "  ✓ Up to date"

# ── Update Claude Code CLI ────────────────────────────────────────────────────

echo ""
echo "→ Updating Claude Code CLI"
claude update || echo "  ⚠  claude update failed (non-fatal — continuing)"

# ── Re-run setup ─────────────────────────────────────────────────────────────

echo ""
echo "→ Re-running setup to apply latest context and commands"
echo ""
bash "$SCRIPT_DIR/setup.sh"

echo ""
echo "✅ Update complete."
echo ""