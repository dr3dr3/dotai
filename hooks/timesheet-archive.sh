#!/usr/bin/env bash
# Timesheet evidence archive (Claude Code SessionStart hook)
# ---------------------------------------------------------------------------
# Copies the metadata of prompts André typed into Claude Code — uuid, timestamp,
# project, session id, git branch — into ~/.ai/timesheet/claude-prompts.jsonl,
# and each session's auto-generated title into claude-sessions.json. The
# timesheet skill bills and reports from these.
#
# Why: Claude Code prunes transcripts (cleanupPeriodDays), and by 2026-10-04
# everything before 14 Sep was already gone — the month being invoiced had
# lost half its best evidence. Never prompt text.
#
# Runs detached and silent so it never slows or clutters a session start.
script="$HOME/.claude/skills/timesheet/scripts/timesheet.ts"
[ -f "$script" ] || exit 0
command -v node >/dev/null || exit 0
nohup node "$script" archive --quiet >/dev/null 2>&1 &
exit 0
