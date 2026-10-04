---
name: timesheet
description: Fill André's Datafaced Harvest timesheet for a month from activity evidence — Claude Code prompts he typed, his GitHub commits and PRs in the rock-of-eye org, and Google Calendar meetings — bucketed into 30-minute slots, reviewed, then pushed as one Harvest entry per day. Use when he says "do my timesheet", "fill in Harvest for September", "/timesheet 2026-10", "how many hours did I work last month", or "invoice my hours". Personal to André; never pushes without his explicit yes.
---

# Timesheet

André invoices Rock of Eye through Datafaced, his company, using Harvest: one project, one
task, duration entries, one entry per day. This skill turns the month's activity evidence into
those entries.

Script: `scripts/timesheet.py` (Python stdlib, plus `gh` for GitHub). Run it from this
skill's directory.

## The model — agreed 2026-10-04; do not tune it to hit a target

- A **30-minute slot** is billed when it contains evidence: a typed Claude prompt, a commit, a
  PR or issue opened, or a calendar meeting.
- A gap of **≤ 30 minutes** between two billed slots is billed too. Nothing is added before
  a session's first event.
- Days and weeks are in `Australia/Brisbane` (`--tz` / `TIMESHEET_TZ` to change).
- **Day limits (André, 2026-10-04):** a day measuring **under 1 hour is not logged** (exactly
  1h is), and **no day logs more than 14 hours** (`--min-day`, `--max-day`). The draft shows
  the measured hours next to the logged hours for any day a limit changed.
- **Evidence marker:** every note the tool writes starts with
  `[timesheet ✓ <measured>h measured[, capped at 14h] · <span> · <counts>]`. A Harvest entry
  without that prefix was typed by hand and has no evidence behind it from this tool. Tool
  entries also carry `external_reference.id = timesheet:YYYY-MM-DD`.

André aims for 50–60 hours a week, weekends included. Treat that as a **calibration check,
never a setting**. If a week comes out far outside it, find the cause (missing evidence, an
agent wave) and tell him. Never adjust `--gap-fill` until the total looks right: the hours
only count as evidence while the rules stay fixed.

Known limits. Say these when you present a month:
- **Agents commit and open PRs as dr3dr3.** Days that rest on GitHub alone can include
  agent time; eight identical PRs inside a minute is the signature. Firstmate crew sessions
  and `bypassPermissions` prompts are already excluded from the Claude evidence.
- **Claude evidence only covers sessions on this machine** whose transcripts reached the
  ledger (`~/.ai/timesheet/claude-prompts.jsonl`, filled by the `timesheet-archive.sh`
  SessionStart hook). Sessions on the Mac or Omarchy host are not in it.
- **Work that leaves no trace** (reading, calls not in the calendar, thinking) is not
  counted. The method leans low, which is the right direction for an invoice.

## Flow

1. **Meetings (optional, but ask).** Use the Google Calendar connector to list the month's
   events on André's primary calendar. Leave out all-day events, declined events, and
   blocks that are not meetings ("Focus", "OOO", travel). Show him the list, then write it
   to `$TMP/meetings-YYYY-MM.json` as `[{"start": iso, "end": iso, "title": "..."}]` with
   timezone offsets. If the connector is not authenticated, say so and continue without
   meetings. Do not block on it.

2. **Draft:**
   ```bash
   python3 scripts/timesheet.py draft 2026-09 --meetings "$TMP/meetings-2026-09.json"
   ```
   GitHub search allows 30 requests/min, so a month takes about 3 minutes the first time.
   A finished month is cached in `~/.ai/timesheet/cache/`; `--refresh` re-fetches it.

3. **Review with André.** Show the weekly totals and the month total, and flag:
   - weeks outside 50–60h, and the reason;
   - days that rest on GitHub alone (`claude=0`) with heavy commit or PR counts;
   - days where the span runs past midnight or starts before 06:00.

   He decides. If he wants a day changed, ask why and fix the evidence (for example, add a
   missing meeting). Do not edit the numbers by hand.

4. **Dry-run the push:** `python3 scripts/timesheet.py push 2026-09 [--meetings …]`.
   This reads Harvest and prints create / update / delete / skip for each day.
   - A day that already has an entry the tool did not make is **skipped**. Tell him; never
     overwrite it.
   - Locked (invoiced or approved) entries are skipped.
   - A tool entry whose day now falls under the 1h minimum is **deleted**.

5. **Apply only after an explicit yes** to that exact dry-run:
   `python3 scripts/timesheet.py push 2026-09 --apply`.
   Re-runs are safe: each entry carries `external_reference.id = timesheet:YYYY-MM-DD` and is
   updated in place.

## Harvest credentials

`~/.config/datafaced/harvest.env` (override the path with `HARVEST_ENV`), mode 600:

```
HARVEST_ACCOUNT_ID=1234567
HARVEST_TOKEN=...            # personal access token from id.getharvest.com/developers
HARVEST_PROJECT=Rock of Eye  # project name, code, or id
HARVEST_TASK=Development     # task name or id
```

This is Datafaced's credential, not a Rock of Eye one. Keep it out of
`~/.config/roe/tooling.env` and out of any RoE repo.
