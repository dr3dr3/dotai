---
name: wip-tracker
description: Track work-in-progress across multiple concurrent AI coding sessions (Claude Code / Copilot / Cursor). Maintains a per-session index of PRs, their live status, and deploy status, and tells you which session/window to return to. Use when the user asks "what am I working on", "what's my WIP", "which sessions are open", "what PRs are still open", "register this session", "register or update this session", "track this PR", "is this session tracked", "what needs my attention", "continue the WIP for X here", "pick up a prior session's work in this fresh session", "clean up my WIP", "triage the board", "help me focus / what should I pick up", or wants to resume unfinished work across parallel sessions that this board already tracks. Also fires on the user's daily shorthand: "my wip" (show the board), "track this" (register/update this session), "track PR #NNN" (attach a PR), "update wip"/"sync my wip" (full mid-work sync of this session), "park it — <next step>" (leave a handoff note via set --next), "pick up <name>" (handoff into this session), "tidy my wip" (cleanup + focus triage), "wip cheatsheet" (print the daily-prompts card). Resuming work that is NOT on the board — never registered, registered on another machine, or named only by topic ("pick up our work on observability tooling", "we lost that session") — is the pick-up skill's job, not this one's: it searches sessions/branches/PRs/Linear for the work, then hands it back here to register.
---

# WIP Tracker

A **session-layer index on top of your PRs**. It answers the one thing `gh`,
Linear, and `make pr-status` cannot: *which conversation/window was I in for
this work, and what is the one thing left to do?*

- **Storage** — one JSON file per session under `/workspace/.wip/` (override
  with `$WIP_DIR`). One file per session ⇒ concurrent sessions never clobber
  each other. `/workspace/.wip/` is gitignored.
- **Durable vs live** — the file stores only the hard-to-derive session↔work
  mapping and your intent. PR state, CI, and deploy status are refreshed **live**
  from `gh` + `build-info.txt` on every view, so it is never silently stale.
- **The engine is `scripts/wip.sh`** — run it; do not hand-roll `gh` calls.

Path to the script (resolve the symlink target if needed):
`~/.claude/skills/wip-tracker/scripts/wip.sh`

## Daily shorthand → what to do

The user drives this with tiny phrases. Map them:

| Says | Do |
|------|----|
| **"my wip"** / "what's my wip" | `view` — print the cockpit |
| **"track this"** | register/update THIS session (resolve by resume id; infer name/linear/PRs) |
| **"track PR #NNN"** | `add-pr` to this session (detect repo from cwd) |
| **"update wip"** / "sync my wip" | full mid-work sync of THIS session — see below |
| **"park it — ‹next step›"** | `set --next "‹next step›"` on this session — the handoff note |
| **"pick up ‹name›"** | resolve slug → `handoff <slug>` (brief + take ownership here) |
| **"tidy my wip"** | run the Triage: cleanup & focus flow |
| **"wip cheatsheet"** | `bash .../wip.sh cheatsheet` — print the daily-prompts card verbatim |

Whatever the phrasing, honour intent. Keep responses tight — these are habit prompts,
not conversations.

## Everyday command

Almost always the user just wants the cockpit. Run:

```bash
bash ~/.claude/skills/wip-tracker/scripts/wip.sh view
```

`view` = refresh all sessions live, then render a priority-sorted cockpit
(❌ failing CI → ✅ approved & mergeable → 🚢 merged-not-deployed → ⏳ awaiting
review → 📝 draft → 🌱 in-progress → 🚀 deployed/verify → ✔️ done). Print the
output. Add a one-line reading only if something clearly needs the user now
(e.g. "api#976 is merged but not on staging — verify then promote to master").

## Registering (or updating) the current session

When the user says "track this" / "register this session" / "register or update
this session" / starts real work, record this session. The script auto-captures
the resume id (`$CLAUDE_CODE_SESSION_ID`), harness, cwd, branch, and worktree
path — you only supply the human bits:

```bash
bash .../wip.sh register --name "Compact labour form" --linear ENG-2129 \
     --next "get review, then promote api→master"
```

- Ask for `--name` and `--linear` if you don't know them (infer `--linear` from
  the branch, e.g. `feat/eng-2129-...` → `ENG-2129`, and confirm).
- The slug is derived from the Linear id (else branch). `register` is idempotent
  — re-running updates the record and re-captures the session.

**"register" and "update" are the same operation — always safe to run.** If this
session is already tracked, `register` (with no `--slug`) matches it by resume id
and updates it **in place** — it never creates a duplicate. So do NOT stop or
deliberate when you find an existing record: treat "already tracked" as the
normal case, apply the update, and say so in one line (e.g. "Updated your existing
entry ‹slug›."). Don't narrate it as a problem or ask whether to re-register.

**Branch capture — pass `--branch` on a shared checkout.** RoE's `/workspace` and
`/workspace/repos/*` are ONE shared checkout per repo volume: any parallel session
moves the branch, so the auto-captured HEAD is last-writer-wins, not this
session's. The tracker detects this — it marks such a branch **unreliable and
hides it** in the cockpit (identity still holds via the resume id). Only a
**worktree** checkout yields a trustworthy auto branch. So when you know the
branch this session actually worked on (you created/pushed it — even if it's since
been merged and deleted), pass it explicitly so the record is accurate:

```bash
bash .../wip.sh register --name "…" --branch fix/eng-2345-preview-media
bash .../wip.sh set --slug "$SLUG" --branch fix/eng-2345-preview-media   # correct it later
```

An explicit `--branch` (or a worktree) is shown; a bare shared-checkout HEAD is
not. Never present the auto-captured branch of a `/workspace`-rooted session as
fact.

## Updating a session that's already tracked

When the user is inside an already-tracked session and wants to update its entry
("update my WIP", "track the PR I just raised", "mark this awaiting review",
"set my next step to …"), **resolve this session's slug first** — don't guess it
from the branch, and don't create a second record:

```bash
SLUG=$(bash .../wip.sh whoami)   # this session's record, matched by resume id
```

Then apply the update with that slug (`set` / `add-pr` / `depends`), e.g.:

```bash
bash .../wip.sh set --slug "$SLUG" --state awaiting-review --next "ping reviewer"
bash .../wip.sh add-pr --slug "$SLUG" --repo rock-of-eye-api --number 977
```

**"update wip" / "sync my wip" — the mid-work catch-all.** When the user has done
more work and wants the record to reflect reality, do a full sync of THIS session
(don't make them spell out each field):

1. `SLUG=$(bash .../wip.sh whoami)` — resolve this session (if empty, `register` first).
2. **Attach any new PRs** opened here that aren't on the record yet — detect from the
   cwd repo (`gh pr list --author @me` / `gh pr view`), `add-pr` each with its target.
3. **Refresh `--next`** to the current concrete next step (infer from recent work;
   confirm in one line) and `set --notes` if state/context changed.
4. `bash .../wip.sh view` (or refresh + show the entry) so the user sees the result.

Keep it to one pass — attach, set, show — no interrogation.

`register` with no `--slug` also self-heals: it now matches this session by
resume id and updates the existing record in place (even if it was created under
a custom slug), so re-registering never duplicates. If `whoami` prints nothing,
the session isn't tracked yet — `register` it (see above). Finish by printing
`view` so the user sees the updated cockpit.

## Continuing a WIP in a FRESH session (handoff)

The user closed the session that owned some work and wants to pick it up **here**,
in a new session, without `claude --resume`-ing the old one ("continue the WIP for
the SSO login work", "pick up ‹slug› here", "resume the preview work in this
session"). Do this:

1. **Resolve the slug** from the name (run `wip.sh list`; match the user's words to
   a record).

   **No record matches?** Then this board never tracked that work — stop and use
   the **`pick-up`** skill instead. It searches the durable evidence (past AI
   sessions, MemPalace/memory, branches, worktrees, local-only commits, org-wide
   PR search, Linear, scratch artifacts), confirms the thread with the user, and
   registers it back here when it's done. Don't guess a slug, and don't
   `register` a fresh empty record as if the history didn't exist.

   With a match, run:

   ```bash
   bash .../wip.sh handoff <slug>      # aliases: resume, continue
   ```

2. `handoff` prints a **brief** (Linear, state, PRs w/ live status, blockers, notes,
   next-action, where to work) and **moves ownership to this session** — the record's
   resumeId now points here (old one saved in `priorSessions`); PRs/next/notes and the
   **work location are preserved**. After this, "update my WIP" targets it from here.

3. **Adopt the brief as your context** and **go to the work**: `cd` to "Work in:";
   if it's a worktree, stage it (`make stage-worktree REPO=… BRANCH=…`). Treat a
   branch flagged as "shared checkout" with suspicion — confirm the real branch.

4. **Deep context on demand only.** The brief prints a `History:` path — the prior
   session's full transcript (`…/<resumeId>.jsonl`). Read/summarise it **only if**
   the next-action is thin, the user asks for full history, or you need a decision's
   rationale. Otherwise the curated brief is enough — don't burn tokens on it by
   default.

5. **Confirm the plan in 1–2 lines** and continue the work. Update the record as you
   go (`set --next …`, `add-pr …`).

## Attaching a PR

Right after a PR is raised (or when the user mentions one), attach it. Detect
repo + number from the current dir when possible:

```bash
# auto-detect from cwd:
gh pr view --json number,headRepository -q '.number'   # then:
bash .../wip.sh add-pr --slug eng-2129-... --repo rock-of-eye-api --number 976 --target staging
```

`--target` is the PR's base branch intent (`staging`, `master` for PMS-Core, or
`prod`). A session can hold several PRs across repos (stacked / cross-repo work).

## Updating state / notes

```bash
bash .../wip.sh set --slug eng-2129-... --state awaiting-review --next "ping Sarada"
```

Workstream `--state` values: `in-progress`, `blocked`, `awaiting-review`,
`approved`, `merged`, `deployed`, `verified`, `done`. (Per-PR state is derived
live and shown separately — don't hand-set it.)

## Cross-session dependencies (blocked-on)

When a workstream can't land until another session's work is done, record it so
the cockpit shows it explicitly instead of burying it in the next-action text:

```bash
# reference a PR (best — auto-links to the session that owns it, if tracked):
bash .../wip.sh depends --slug eng-2129-... --on rock-of-eye-api#185 --note "warm-cache AMI bake"
# or reference another session's slug directly, or free text:
bash .../wip.sh depends --slug eng-2129-... --on chore-preview-rollout-enablement
bash .../wip.sh depends --slug eng-2129-... --remove rock-of-eye-api#185   # or --clear
```

The cockpit renders a `⛔ blocked on …` line per dependency. If the ref is a
`repo#num` (or bare `#num`) and some **tracked** session owns that PR, it
resolves to that session's name **and its `claude --resume` id** — so you can
jump straight to the window that unblocks you. If nothing tracks it yet, it
shows the ref plainly and the link lights up automatically once that session
registers. Note: `dependsOn` doesn't change a row's rank — it annotates it.

## Leave a handoff note before a session closes

The `handoff` brief is only as good as the `next` (and `notes`) captured before the
session was closed. So treat a wrapping-up session as a cue to record one — this is
the single highest-value habit for making a fresh session able to continue.

**When to prompt for it.** If this session is tracked and the user signals they're
wrapping up — "done for now", "I'll stop here", "closing this", "EOD", stepping
away, or they just committed/pushed and the immediate task is finished with nothing
queued this turn — proactively offer a one-line handoff note:

```bash
bash .../wip.sh set --slug "$(bash .../wip.sh whoami)" \
     --next "the very next concrete step" \
     --notes "where things stand / any gotcha the next session needs"
```

- Make `--next` a *concrete next action* ("rebase #239 on master, then request review"),
  not a status ("in progress"). That sentence is what a fresh session acts on.
- Keep it to **one crisp confirm** — propose the note, apply on a yes. Do NOT nag
  every turn or re-ask once it's set.
- The cockpit flags records that lack this: the header shows `⚠ N without a handoff
  note` and each such row shows `⚠ no handoff note`. If you see that flag for the
  current session while wrapping up, fix it.

## Triage: cleanup & focus

When the user asks to "clean up my WIP", "triage the board", "help me focus", or
"what should I pick up" — run this as a guided pass, not a bulk auto-action. It
combines the tracker (the index) with `gh` (PRs), Linear (tickets), and git
(branches). **Do the safe, reversible steps freely; confirm anything destructive.**

### 1. Survey (live)
```bash
bash .../wip.sh view          # refreshes every record's PRs/CI/deploy live
```
Read the board top-to-bottom. Note ⏳ `Nd cold` flags (stale) and `⚠ no handoff
note` flags.

### 2. Cleanup
- **Archive finished work.** Records that are 🚀 (all PRs merged) or ✔️ (done) are
  clutter. Propose the sweep, then:
  ```bash
  bash .../wip.sh archive --merged   # refreshes, then archives all rank 6+7 records
  ```
  It prints what it archived; it's reversible (files go to `.wip/archive/`).
- **Linear — READ-ONLY.** For each remaining record with a `linear` id, check the
  ticket via the Linear MCP (`get_issue`, `list_comments`) or the `linear` CLI:
  has it moved to Done/Cancelled (work may be moot → flag for archive)? New comments
  in recent days needing a reply? **Never mutate Linear** in a triage pass — no
  `save_issue` (it overwrites the description), no status changes — unless the user
  explicitly asks. Report; don't act.
- **Local branch cleanup — CAREFUL (this is the one place you can lose work).**
  Prefer the `review-git-branches` skill for the actual sweep. Rules:
  1. A branch is a deletion candidate **only if its PR is merged/closed — proven via
     `gh pr view`, NOT the record's `branch` field** (a shared-checkout branch is
     last-writer-wins and may be wrong or already gone).
  2. `git worktree list` first and **never delete a branch a worktree holds**
     (`/workspace/repos/*/.worktrees/*`, `/workspace/.worktrees/*`) — another session
     is using it.
  3. A local branch with **no** PR: ask before deleting; it may be unpushed work.
  Present the candidates with their merged-PR proof; delete only on an explicit yes.

### 3. Focus
After archiving, the board is just the in-flight set, already rank-sorted (❌ fix CI
→ ✅ land → 🚢 deploy → ⏳ review → 📝 draft → 🌱 wip). Layer on:
- **staleness** (⏳ cold = losing momentum), **Linear priority/state**, and
- **blocker edges** — a record that *others* depend on (someone else's `⛔ blocked on`
  points at its PR) is higher-leverage; unblocking it frees another session.

Produce a short **"pick up next" list (top ~3)**: each with its one next action and
the command to resume it — `claude --resume <id>` (reopen the old session) or
`wip.sh handoff <slug>` (continue here in this session). Then offer to `handoff` the
top pick.

### Guardrails recap
Archive = reversible. Linear = read-only. Branch deletion = merged-PR proof +
worktree check + explicit confirmation. Never present a shared-checkout branch as fact.

## Finishing up

When a workstream is fully merged **and** deployed **and** verified, archive it
(keeps history, shrinks the active list):

```bash
bash .../wip.sh archive eng-2129-...
```

## Guardrails

- **Deploy status is best-effort.** api / sso / pms-core staging are verified by
  comparing `build-info.txt` `GIT_SHA` to the PR's merge commit. **Portals have
  no build stamp → `unknown`** (say so, don't imply not-deployed). Prod is manual
  `workflow_dispatch` and not auto-checked — when a merged PR targets `master`,
  remind the user to run the prod deploy + verify.
- **Graceful degradation.** No `gh` auth / no network ⇒ the cockpit shows the
  last-known snapshot. Mention it's a cached view rather than presenting stale
  data as live.
- **Never invent status.** If the script says `unknown`, report `unknown`.
- **This is local, per-user state.** `/workspace/.wip/` is gitignored and never
  committed. Don't add it to any repo.

## For deeper detail

See `REFERENCE.md` for the full data model, the ranking table, and the
build-info deploy-detection contract. Automatic capture (a Stop hook / `gh pr
create` wrapper so sessions and PRs self-register) is a planned v2 — v1 is
manual invoke.
