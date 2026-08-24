#!/usr/bin/env bash
# =============================================================================
# Back up (and restore) Claude's memory dir — the highest-signal corpus we own
# =============================================================================
# ~/.claude/projects/-workspace/memory/ holds the hand-distilled memories: the
# MEMORY.md index plus ~290 one-fact files. Two facts explain why it exists:
#
#   1. It USED TO live on the CONTAINER OVERLAY, NOT the /workspace host bind,
#      so a devcontainer rebuild deleted every file. NO LONGER TRUE as of
#      local-dev-env bc8cef3 (2026-08-19): ~/.claude is now a symlink to
#      ~/.ai/claude on the persisted `roe-devcontainer-ai` volume, so the live
#      dir survives a rebuild on its own. This backup is therefore a SECOND
#      line of defence rather than the only one — keep it anyway: that volume
#      is still one local Docker object, and `docker compose down -v` or
#      `make clean-all` will delete it without ceremony.
#   2. Until 2026-08-18 its only off-container copy was MemPalace, which had
#      been frozen since 2026-06-28. A rebuild in that window would have lost
#      seven weeks of distilled memory with nothing to restore from.
#
# Proven in anger on 2026-08-19: a Docker Desktop VM restart forced a
# devcontainer recreate minutes BEFORE the AI volume existed. The live memory
# dir came back empty and `--restore` rebuilt all 292 files from state/.
# MemPalace could NOT have covered it — its newest mined content was ~6h stale.
#
# So: a plain file copy into the gitignored mempalace/state/ (host bind,
# survives rebuilds). Deliberately independent of MemPalace — it must work when
# the palace is down, which is exactly when you need it.
#
# The copy is gitignored (.gitignore: `mempalace/state/`) and MUST stay that
# way: these files carry Rock of Eye detail and dotai is a personal repo.
#
#   bash mempalace/backup-memory.sh            # back up  (live → state/)
#   bash mempalace/backup-memory.sh --restore   # restore  (state/ → live)
# =============================================================================
set -euo pipefail

LIVE="$HOME/.claude/projects/-workspace/memory"
BACKUP="/workspace/.ai/dotai/mempalace/state/memory-backup"

# `|| true` matters: under `set -o pipefail`, find exits non-zero when the dir
# doesn't exist yet (first-ever backup) and would abort the script.
count() { { find "$1" -type f -name '*.md' 2>/dev/null || true; } | wc -l; }

if [ "${1:-}" = "--restore" ]; then
    [ -d "$BACKUP" ] || { echo "✖ no backup at $BACKUP" >&2; exit 1; }
    n="$(count "$BACKUP")"
    [ "$n" -gt 0 ] || { echo "✖ backup is empty — refusing to restore over live" >&2; exit 1; }
    mkdir -p "$LIVE"
    # Never delete live files that aren't in the backup: restore is additive,
    # so running it on a healthy container can't destroy newer memories.
    cp -an "$BACKUP"/. "$LIVE"/ 2>/dev/null || true
    echo "✅ restored (additive) — backup had $n files; live now has $(count "$LIVE")"
    echo "   Existing live files were NOT overwritten. To force, copy by hand."
    exit 0
fi

[ -d "$LIVE" ] || { echo "✖ no memory dir at $LIVE — nothing to back up" >&2; exit 1; }
before="$(count "$BACKUP")"
mkdir -p "$BACKUP"
cp -a "$LIVE"/. "$BACKUP"/
after="$(count "$BACKUP")"
echo "✅ backed up $(count "$LIVE") files → $BACKUP  (was $before, now $after)"
echo "   $(du -sh "$BACKUP" | cut -f1) on the /workspace host bind, gitignored."
