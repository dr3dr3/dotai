---
name: wip-tracker
description: Track work-in-progress across multiple concurrent AI coding sessions (Claude Code / Copilot / Cursor). Maintains a per-session index of PRs, their live status, and deploy status, and tells you which session/window to return to. Use when the user asks "what am I working on", "what's my WIP", "which sessions are open", "what PRs are still open", "register this session", "track this PR", "what needs my attention", or wants to resume unfinished work across parallel sessions.
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

## Registering the current session

When the user says "track this" / "register this session" / starts real work,
create this session's record. The script auto-captures the resume id
(`$CLAUDE_CODE_SESSION_ID`), harness, cwd, branch, and worktree path — you only
supply the human bits:

```bash
bash .../wip.sh register --name "Compact labour form" --linear ENG-2129 \
     --next "get review, then promote api→master"
```

- Ask for `--name` and `--linear` if you don't know them (infer `--linear` from
  the branch, e.g. `feat/eng-2129-...` → `ENG-2129`, and confirm).
- The slug is derived from the Linear id (else branch). `register` is idempotent
  — re-running updates the record and re-captures the session.

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
