#!/usr/bin/env bash
# Auto-memory index budget warning (Claude Code PostToolUse hook)
# ---------------------------------------------------------------------------
# Warns when the auto-memory index MEMORY.md approaches the size at which
# Claude Code silently stops loading it.
#
# Why: only the first 200 LINES or 25,000 CHARACTERS of MEMORY.md — whichever
# comes first — are loaded at the start of every session. Everything past that
# is dropped, silently, at the next load. Claude Code itself only complains
# once the file is already at or over a limit; by then the index has been
# shipping truncated for however long it took to notice. On 2026-08-24 this
# index reached ~25,900 characters and its tail had stopped loading.
#
# Two limits, not one, and CHARACTERS bind first in practice: entries group
# several memories onto one line, so the index runs out of characters while
# still well short of 200 lines. Do not assume the line count is the headroom.
#
# Scope: fires only on a write to a file named MEMORY.md that sits inside a
# directory named `memory` (i.e. an auto-memory index — not some project's
# own MEMORY.md). Silent until 90% of either budget.
#
# Fixing it means compacting the INDEX, never deleting memories: shorten hooks
# to a distinguishing cue, group related memories onto one line, and move
# settled initiatives into ARCHIVE.md. The detail already lives in the topic
# files — verify that before trimming a hook, then trim freely.
#
# Contract: PostToolUse hook. Reads the tool-call JSON on stdin; the write has
# already happened, so exit 2 does not block anything — it surfaces the warning
# to Claude so the index gets compacted in the same session. Any other failure
# exits 0 (fail-open) so a hook bug never wedges the session.
#
# Tunable: MEMORY_INDEX_MAX_LINES, MEMORY_INDEX_MAX_BYTES, MEMORY_INDEX_WARN_PCT.

set -uo pipefail

MAX_LINES="${MEMORY_INDEX_MAX_LINES:-200}"
MAX_BYTES="${MEMORY_INDEX_MAX_BYTES:-25000}"
WARN_PCT="${MEMORY_INDEX_WARN_PCT:-90}"

command -v jq >/dev/null 2>&1 || exit 0

input="$(cat)"

tool="$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)"
case "$tool" in
  Write|Edit|MultiEdit|NotebookEdit) ;;
  *) exit 0 ;;
esac

file="$(printf '%s' "$input" | jq -r '.tool_input.file_path // empty' 2>/dev/null)"
[ -n "$file" ] || exit 0

# Auto-memory index only: .../<something>/memory/MEMORY.md
[ "$(basename "$file")" = "MEMORY.md" ] || exit 0
[ "$(basename "$(dirname "$file")")" = "memory" ] || exit 0
[ -f "$file" ] || exit 0

lines="$(wc -l < "$file" 2>/dev/null | tr -d ' ')"

# Claude Code measures the index in CHARACTERS, not bytes. That distinction is
# load-bearing here: a severity-marker convention (🔴🔑⚠️✅) makes this file
# ~3% larger in bytes than in characters — 600+ characters of phantom size at
# this scale, against a headroom of one or two thousand. Count characters, and
# fall back to bytes (an over-estimate, so it errs toward warning early) only
# if python3 is unavailable.
bytes="$(python3 -c 'import sys,io;print(len(io.open(sys.argv[1],encoding="utf-8",errors="replace").read()))' "$file" 2>/dev/null)"
[ -n "$bytes" ] || bytes="$(wc -c < "$file" 2>/dev/null | tr -d ' ')"
[ -n "$lines" ] && [ -n "$bytes" ] || exit 0

warn_lines=$(( MAX_LINES * WARN_PCT / 100 ))
warn_bytes=$(( MAX_BYTES * WARN_PCT / 100 ))

[ "$lines" -ge "$warn_lines" ] || [ "$bytes" -ge "$warn_bytes" ] || exit 0

if [ "$lines" -ge "$MAX_LINES" ] || [ "$bytes" -ge "$MAX_BYTES" ]; then
  state="OVER BUDGET — the tail of this index is NO LONGER being loaded"
else
  state="approaching its budget"
fi

pct_lines=$(( lines * 100 / MAX_LINES ))
pct_bytes=$(( bytes * 100 / MAX_BYTES ))

cat >&2 <<EOF
⚠ Auto-memory index $state.

  $file
  lines: ${lines}/${MAX_LINES}  (${pct_lines}%)
  chars: ${bytes}/${MAX_BYTES}  (${pct_bytes}%)

Only the first ${MAX_LINES} lines OR ${MAX_BYTES} characters — whichever comes first — load at
session start. Content past that is dropped silently on the next load.

Compact the INDEX now; do not delete memories:
  • shorten each hook to a distinguishing cue (the detail is in the topic file —
    confirm that before trimming, then trim freely)
  • group related memories onto one line
  • move settled/shipped entries into ARCHIVE.md in the same directory

Re-check: wc -l "$file" && python3 -c 'import sys,io;print(len(io.open(sys.argv[1],encoding="utf-8").read()))' "$file"
EOF
exit 2
