---
name: timesheet
description: Fill André's Datafaced Harvest timesheet for a month from activity evidence — Claude Code prompts he typed, his GitHub commits and PRs in the rock-of-eye org, and Google Calendar meetings — bucketed into 30-minute slots, reviewed, then pushed as one Harvest entry per day. Also reports the month for Mark — where the billed hours went by Linear project (top 10) and PRs opened per developer — and drafts that as a Slack DM. Use when he says "do my timesheet", "fill in Harvest for September", "/timesheet 2026-10", "how many hours did I work last month", "invoice my hours", "where did my hours go", "PRs by developer", or "send Mark the monthly summary". Personal to André; never pushes to Harvest or sends to Slack without his explicit yes.
---

# Timesheet

André invoices Rock of Eye through Datafaced, his company, using Harvest: one project, one
task, duration entries, one entry per day. This skill turns the month's activity evidence into
those entries.

Script: `scripts/timesheet.ts` — TypeScript run directly by Node ≥ 22.18, no build step and no
runtime dependencies; it shells out to `gh` (GitHub) and `linear api` (Linear, which
authenticates itself). Run it from this skill's directory as `node scripts/timesheet.ts …`.
`npm ci && npm test && npm run typecheck` for development; CI runs the same.

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
   node scripts/timesheet.ts draft 2026-09 --meetings "$TMP/meetings-2026-09.json"
   ```
   GitHub search allows 30 requests/min, so a month takes about 3 minutes the first time.
   A finished month is cached in `~/.ai/timesheet/cache/`; `--refresh` re-fetches it.

3. **Review with André.** Show the weekly totals and the month total, and flag:
   - weeks outside 50–60h, and the reason;
   - days that rest on GitHub alone (`claude=0`) with heavy commit or PR counts;
   - days where the span runs past midnight or starts before 06:00.

   He decides. If he wants a day changed, ask why and fix the evidence (for example, add a
   missing meeting). Do not edit the numbers by hand.

4. **Dry-run the push:** `node scripts/timesheet.ts push 2026-09 [--meetings …]`.
   This reads Harvest and prints create / update / delete / skip for each day.
   - A day that already has an entry the tool did not make is **skipped**. Tell him; never
     overwrite it.
   - Locked (invoiced or approved) entries are skipped.
   - A tool entry whose day now falls under the 1h minimum is **deleted**.

5. **Apply only after an explicit yes** to that exact dry-run:
   `node scripts/timesheet.ts push 2026-09 --apply`.
   Re-runs are safe: each entry carries `external_reference.id = timesheet:YYYY-MM-DD` and is
   updated in place.

## Monthly report for Mark

Two numbers, for the same month as the invoice:

```bash
node scripts/timesheet.ts report 2026-09 --from-harvest --unassigned-json "$TMP/unassigned.json" --json "$TMP/report.json"
```

**Hours by area.** Each billed slot's half hour is shared among the evidence inside it. A
bridged slot takes the average of its nearest evidenced neighbours, and each day is scaled
to the hours billed. `--from-harvest` scales to what is actually on the invoice, including
André's hand-typed days. A billed day with no evidence at all shows as "Manual entries (no
evidence)" rather than being spread across areas.

The areas are **Linear projects, a fixed list** (André, 2026-10-05: Linear-anchored, so months
compare). An item's area comes from, in order:
1. a ticket in its PR or commit title → that ticket's Linear project;
2. an assignment in `~/.ai/timesheet/areas-YYYY-MM.json`, made by you;
3. otherwise "Unassigned".

**Assigning the rest is your job, and only from `allowed`.** `--unassigned-json` lists every
decision still open, as `{allowed, items: [{key, label, hours, repo?}]}`. Write
`areas-YYYY-MM.json` as a flat `{key: area}` object, using:
- `ticket:ENG-NNNN`: a ticket with no project, covering all its commits and PRs at once. The
  label carries the ticket title and labels.
- `session:<id>`: a Claude session, labelled with its auto-generated title. **Classify by
  the title, not the branch.** The shared /workspace checkout sits on whatever branch another
  session left it on, so the branch in the label is a weak hint. This is also why sessions
  never take a ticket from their branch automatically.
- `repo:<name>`: a default for a single-purpose repo's unticketed items (for example
  `roe-explainers` → T13). Mixed repos (local-dev-env, rock-of-eye-*, infrastructure) need
  item-level keys, or a repo default plus item overrides.

Never invent an area; the script refuses values outside the list. A big classification job
is a good fit for a subagent. Re-run `report` until "Unassigned" is gone or André accepts
what remains. Show him the ten least certain calls.

The report also rolls the areas up by **theme**, read from the Linear prefix: P → Product,
T → Platform & engineering, S → Supply chain, Onboard → Tenant onboarding. Lead with this for
Mark, because the top ten projects leave a large "Other".

**PRs by developer.** Every PR opened in the org that month, per author: opened, merged,
closed without merging, still open, repos touched. Bots are listed apart. Two cautions,
which must travel with the number:
- **dr3dr3's count is André directing agents.** Nearly all of it is agent-written under his
  account. Only Firstmate crew PRs carry a marker (the `crew` column), so there is no honest
  way to split the rest.
- **A count is not output.** It says nothing about size or difficulty. Present it as a
  count, never as a ranking or a judgement of anyone. This report goes to the founder.

### Sending it to Mark

Use the `draft-post` skill in the **founder register**: a headline, three bullets, one ask,
in business language, with no engineering detail. A good shape:
- the headline: hours billed for the month;
- bullet 1: where the hours went, as the top three to five areas with percentages;
- bullet 2: PRs opened, with the per-developer counts on one line and the dr3dr3 caveat in
  plain words ("most of mine are agent-written under my direction");
- bullet 3: one notable shift from last month, if there is one;
- the ask: only if André has one, otherwise none.

Show André the exact text. Send it to Mark's DM (find his user with Slack search) only after
an explicit yes to that text; otherwise save it as a Slack draft. Never send without that yes.

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
