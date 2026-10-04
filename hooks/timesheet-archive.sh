#!/usr/bin/env bash
# Timesheet evidence archive (Claude Code SessionStart hook)
# ---------------------------------------------------------------------------
# Copies the timestamps of prompts André typed into Claude Code into
# ~/.ai/timesheet/claude-prompts.jsonl, which the timesheet skill bills from.
#
# Why: Claude Code prunes transcripts (cleanupPeriodDays), and by 2026-10-04
# everything before 14 Sep was already gone — the month being invoiced had
# lost half its best evidence. The ledger keeps uuid + timestamp + project
# only, never prompt text.
#
# Runs detached and silent so it never slows or clutters a session start.
script="$HOME/.claude/skills/timesheet/scripts/timesheet.py"
[ -f "$script" ] || exit 0
command -v python3 >/dev/null || exit 0
nohup python3 "$script" archive --quiet >/dev/null 2>&1 &
exit 0
