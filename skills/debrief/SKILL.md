---
name: debrief
description: Produce a plain-English executive debrief of the current session — goals and how they've drifted, what's verifiably done, what's left, blockers and open questions, key decisions and dead ends, and a single recommended next move. Use when the user says "debrief", "let's do a debrief", "recap this session", "where are we", "zoom out", "catch me up", "give me an executive summary of this session", "what have we done and what's left", "status check", "I've lost the thread", or returns to a long-running session wanting the holistic picture. "Debrief and park it" additionally records a handoff note (via wip-tracker if installed). For status ACROSS multiple sessions use wip-tracker instead; this covers the current session only.
---

# Debrief

A mid-session zoom-out for a human who runs several AI sessions in parallel and
has lost the holistic thread of *this* one. The output is a short, plain-English
executive summary delivered **in chat** — not a file, not a handoff doc (unless
they're parking the session, see below).

## Step 1 — Ground it in reality (verify, don't recall)

Long sessions have compacted context and confidently wrong memories. Before
writing a word, spend ~a minute refreshing the facts you're about to claim:

- `git status` / `git log` on repos touched this session; `gh pr view` /
  `gh pr checks` on any PR raised or discussed.
- Claim test/CI results only if you saw them this session or re-check them now.
- Anything you can't cheaply verify, mark **(unverified)** — never assert it,
  never silently drop it.

This is a fact refresh, not a research project. A handful of read-only commands,
then write.

## Step 2 — The debrief

Hard cap **~50 lines**. Tiered so the first three sentences alone are useful.
Omit a section entirely (or write "none") rather than padding it.

1. **TL;DR** — 2–3 sentences: where we are, and the one thing that matters most
   right now.
2. **Goals — and how they've drifted** — what the session originally set out to
   do, then explicitly: what got added, dropped, or reshaped along the way, and
   why. (The after-action-review question: what was *supposed* to happen vs what
   *happened*.) Silent scope creep is exactly what the user can't see from
   inside the detail.
3. **Done** — verified outcomes, each anchored to a concrete artifact (branch,
   PR number, file, ticket). Outcomes, not activity — "investigated X" only
   earns a line if the finding changes something.
4. **In flight / left to do** — remaining work, in order. Distinguish
   mid-flight (partially done, state noted) from not-started.
5. **Blockers & open questions** — things that need a *different actor*: the
   user's decision, a reviewer, another session, an external system. Kept
   separate from "left to do" because the user must act on these personally.
   If none, say "none — nothing needs you right now."
6. **Decisions & dead ends** — non-obvious decisions taken, each with a
   one-line why (so they don't get re-litigated), and approaches tried and
   abandoned, each with why it failed (so nobody re-runs them). Skip the
   obvious ones.
7. **Recommendation** — the single next best action and why, stated as a
   recommendation, not a menu. Mention at most 1–2 genuine alternatives only if
   the choice is truly the user's to make — and then say which you'd pick.

### Register

- **Plain English, executive altitude, by default.** The reader stepped away
  from the detail: no session-local codenames or shorthand, acronyms spelled
  out on first use, complete sentences. Name artifacts precisely (PR #, branch)
  but don't quote code or paste diffs.
- If the user asks for a **technical debrief**, keep the same structure and
  drop the altitude: file paths, function names, failing test names.

### Anti-patterns

- A chronological narrative of the session. The debrief is organised by *state*,
  not by time.
- Claiming "done" for anything not verified in Step 1.
- Re-opening decisions that were settled — report them under Decisions instead.
- Padding. The value of a debrief is selectivity; if it's long, it has failed.

## Step 3 — Offer the follow-through (one line, optional)

End with one short line offering the natural next move — usually one of:

- **Act on the recommendation** — "Want me to get started on that?"
- **Park it** — if the user is wrapping up ("debrief and park it", EOD, "I'll
  stop here"): record the handoff so a fresh session can continue. If
  wip-tracker is installed (`~/.claude/skills/wip-tracker/`), sync this
  session's record — `--next` from the Recommendation, `--notes` from Blockers
  (see that skill for the commands). Otherwise, or if the user prefers a file,
  write the debrief to `/workspace/tmp/HANDOFF-<slug>.md`.

Don't do either without a yes — the debrief itself is the deliverable.

## Scope

This skill debriefs **the current session only**. If the user wants the picture
across their parallel sessions ("what's all my WIP", "which session should I go
back to"), that's wip-tracker's job — run its cockpit, don't approximate it here.
