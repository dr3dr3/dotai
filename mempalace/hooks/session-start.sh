#!/usr/bin/env bash
# =============================================================================
# MemPalace — Claude Code SessionStart wake-up hook
# =============================================================================
# Injects palace context (L0 identity + L1 essential story, ~600-900 tokens) at
# the start of every Claude Code session, so recall is AUTOMATIC and survives
# devcontainer rebuilds / follows you across machines (the palace lives on the
# tailnet PG backend, not the container). This is the proactive layer the
# plugin's Stop/PreCompact hooks don't provide.
#
# Registered into ~/.claude/settings.json by mempalace/setup.sh (re-run after a
# rebuild — settings.json is container-home and gets wiped).
#
# Strategy: prefer the official `hook run --hook session-start` integration; if
# it yields no context (it can return "{}" — gated/dedup), fall back to emitting
# `wake-up` text as SessionStart additionalContext.
#
# Fail-open: missing binary or unreachable backend (offline / tailnet down) →
# emit nothing, exit 0, never delay or block the session.
# =============================================================================
MP="$(command -v mempalace || echo "$HOME/.local/bin/mempalace")"
[ -x "$MP" ] || exit 0

# 1. Official hook integration (reads harness JSON from stdin).
out="$(timeout 20 "$MP" hook run --hook session-start --harness claude-code 2>/dev/null)"
if [ -n "$out" ] && [ "$out" != "{}" ]; then
    printf '%s' "$out"
    exit 0
fi

# 2. Fallback: emit wake-up body as additionalContext (strip the 2 header lines).
wake="$(timeout 20 "$MP" wake-up 2>/dev/null | sed '1,2d')"
[ -z "${wake// }" ] && exit 0
WAKE="$wake" python3 - <<'PY'
import json, os
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": os.environ["WAKE"],
    }
}))
PY
