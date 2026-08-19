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
#
# STALENESS GUARD (added 2026-08-18)
# ---------------------------------------------------------------------------
# Fail-open is why this hook can't be trusted on its own: a DEAD palace and a
# healthy one look identical. The auto-save hooks stopped writing on 2026-06-28
# and nothing surfaced it for seven weeks — every env kept starting sessions
# happily against a frozen palace. So before emitting, we check how old the
# newest drawer is and prepend a warning when it exceeds MEMPALACE_STALE_DAYS
# (default 7). The check itself is fail-open (short timeout, silent on error) —
# it must never be the reason a session stalls. A missing drawers table is
# reported too: that means the invariants drifted and this env is pointed at a
# fork, not the shared palace.
# =============================================================================
MP="$(command -v mempalace || echo "$HOME/.local/bin/mempalace")"
[ -x "$MP" ] || exit 0

STALE_DAYS="${MEMPALACE_STALE_DAYS:-7}"
CFG="/workspace/.ai/dotai/mempalace/state/config.json"
# The tool venv's python already has psycopg — far cheaper than `uv tool run`.
VENV_PY="$HOME/.local/share/uv/tools/mempalace/bin/python"

staleness_note() {
    [ -x "$VENV_PY" ] || return 0
    [ -f "$CFG" ] || return 0
    STALE_DAYS="$STALE_DAYS" timeout 8 "$VENV_PY" - "$CFG" 2>/dev/null <<'PY'
import datetime, hashlib, json, os, re, sys
try:
    import psycopg
except Exception:
    sys.exit(0)                      # chroma-only env — nothing to check
try:
    cfg = json.load(open(sys.argv[1]))
    if cfg.get("backend") != "pgvector":
        sys.exit(0)
    slug = re.sub(r"[^A-Za-z0-9_]+", "_", cfg["pgvector_namespace"]).strip("_")
    h = hashlib.sha256(cfg["palace_path"].encode()).hexdigest()[:16]
    table = f"mempalace_{slug}_{h}_mempalace_drawers"
    with psycopg.connect(cfg["pgvector_dsn"], connect_timeout=4) as c:
        exists = c.execute(
            "select 1 from pg_tables where tablename = %s", (table,)).fetchone()
        if not exists:
            print(f"[MemPalace] WARNING: drawers table {table} does not exist — "
                  "this env is NOT attached to the shared palace (invariant drift). "
                  "Do not seed; run mempalace/set-dsn.sh to re-verify.")
            sys.exit(0)
        newest = c.execute(f'select max(updated_at) from "{table}"').fetchone()[0]
    if newest is None:
        sys.exit(0)
    age = (datetime.datetime.now(datetime.timezone.utc) - newest).days
    if age > int(os.environ["STALE_DAYS"]):
        print(f"[MemPalace] WARNING: newest drawer is {age} days old "
              f"({newest:%Y-%m-%d}). Auto-save has likely stopped — recall below "
              "is STALE and anything decided since then is missing. "
              "Fix: bash /workspace/.ai/dotai/mempalace/seed.sh")
except Exception:
    sys.exit(0)                      # fail-open, always
PY
}

NOTE="$(staleness_note)"

emit_json() {   # $1 = additionalContext body
    BODY="$1" python3 - <<'PY'
import json, os
print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": os.environ["BODY"],
    }
}))
PY
}

# 1. Official hook integration (reads harness JSON from stdin).
out="$(timeout 20 "$MP" hook run --hook session-start --harness claude-code 2>/dev/null)"
if [ -n "$out" ] && [ "$out" != "{}" ]; then
    if [ -n "$NOTE" ]; then
        # Splice the warning onto the front of the official payload's context.
        OUT="$out" NOTE="$NOTE" python3 - <<'PY' || printf '%s' "$out"
import json, os, sys
try:
    payload = json.loads(os.environ["OUT"])
    hso = payload.setdefault("hookSpecificOutput", {})
    hso["hookEventName"] = "SessionStart"
    hso["additionalContext"] = os.environ["NOTE"] + "\n\n" + hso.get("additionalContext", "")
    print(json.dumps(payload))
except Exception:
    sys.exit(1)          # caller falls back to the untouched payload
PY
    else
        printf '%s' "$out"
    fi
    exit 0
fi

# 2. Fallback: emit wake-up body as additionalContext (strip the 2 header lines).
#
# L1 IS DROPPED BY DEFAULT (MEMPALACE_WAKEUP_L1=1 to restore). Measured twice on
# 2026-08-19: the "## L1 — ESSENTIAL STORY" block is ~700 of the ~1450 tokens and
# is mid-sentence chunk fragments — unscoped it was dominated by one stale June
# topic, and `--wing memory` was WORSE (all 9 fragments from a single memory
# file), so the selection is clustered, not important-first. L0 identity (which
# now carries the memory protocol) is the part that earns its tokens; real recall
# comes from an on-demand `search`, which tests well. Keep the primer cheap.
wake="$(timeout 20 "$MP" wake-up 2>/dev/null | sed '1,2d')"
if [ "${MEMPALACE_WAKEUP_L1:-0}" != "1" ]; then
    wake="$(printf '%s' "$wake" | sed '/^## L1 — ESSENTIAL STORY/,$d')"
fi
if [ -z "${wake// }" ]; then
    # Even with no recall, a stale/forked palace is worth saying out loud.
    [ -n "$NOTE" ] && emit_json "$NOTE"
    exit 0
fi
[ -n "$NOTE" ] && wake="$NOTE"$'\n\n'"$wake"
emit_json "$wake"
