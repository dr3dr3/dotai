# MemPalace — the daily habit

Personal to André. Everything here lives in `dotai`; nothing is team infra.

The point of this file: **you should not have to remember tool names.** You say a
short phrase, the agent does the mechanics. The phrases are also wired into
`identity.txt`, which the SessionStart hook injects into every session — so a
fresh agent already knows this protocol without being told.

---

## The three phrases

| You say | What I do | When |
|---|---|---|
| **"palace check `<topic>`"** | `mempalace_search` with `wing` / `since` filters, before asserting anything | Before trusting either of us on a past decision |
| **"checkpoint this"** | `mempalace_checkpoint` — files the session's decisions verbatim + one diary entry | End of any substantive session |
| **"supersede: X was A, now B"** | `mempalace_kg_supersede` (atomic) | A fact you already filed has *changed* |

Two more, less often: **"remember: `<fact>`"** → `mempalace_add_drawer`, and
**"that's no longer true"** → `mempalace_kg_invalidate` (a fact that simply ended,
with no successor).

---

## Does this reach future sessions automatically?

Two different questions, two different answers — worth keeping apart because
they're easy to conflate:

**Writing is mostly automatic.** Raw transcripts get mined into the palace in
the background (the Stop hook, ~every 15 messages) with no action from you. The
deliberate stuff — `checkpoint` / `remember` / `supersede` into wing `curated` +
the KG — only happens when triggered, by the phrase or by the agent's own
judgment (see below).

**Reading is never automatic.** Nothing injects palace *content* into a
session's context the way `MEMORY.md` does at session start. The SessionStart
hook injects the **protocol** (identity.txt — "here's how to use MemPalace") on
every session, but that's static instructions, not a live query. Actual content
only surfaces when something calls a tool (`mempalace search`,
`mempalace_kg_query`, …) *during* that session.

So:
- **"palace check `<topic>`"** is the deterministic trigger — say it and the
  lookup happens, guaranteed.
- It is not the *only* way in — a session that has the protocol loaded is
  supposed to search before asserting a past decision, unprompted (identity.txt
  rule 2). But that's a judgment call each time, not a guarantee. Treat the
  phrase as the dependable lever; proactive checking is a bonus, not a promise.
- **It's cross-session AND cross-machine** — the palace is one shared Postgres
  backend (namespace `andre-shared`), not scoped to one conversation or one
  devcontainer. Something filed here today is findable from a session on the
  MacBook next month, as long as that session has the plugin + hook wired (see
  Setup above) — a bare Claude Code session without this repo's setup has no
  idea the palace exists, tools or protocol.

---

## The loop, step by step

### 1. Session start — do nothing
The hook injects L0 identity + this protocol (~660 tokens). If the palace has
gone quiet for more than 7 days it also injects a **staleness warning** — that is
your cue to run `seed.sh`, and the thing whose absence let it die unnoticed for
seven weeks in June–August 2026.

### 2. Before relying on "what we decided" — *"palace check ..."*
Recall is good on docs/decisions and weak on raw transcripts, so:

```bash
mempalace search "<keywords>" --wing ai-context --since 2026-07-01
mempalace search "<keywords>" --wing curated        # only what you filed deliberately
mempalace search "<keywords>" --room problems       # rooms: technical|architecture|problems|general
```

**Treat a low-similarity hit as a miss.** There is no confidence threshold in the
CLI — a `0.52` on useless text looks identical to a `0.52` on gold. (The MCP
`mempalace_search` tool *does* take `max_distance`; the CLI does not.)

### 3. Mid-session, a single durable fact — *"remember: ..."*
Files one drawer into wing `curated`. If it's a fact you want in front of the
agent *every* session, it belongs in Claude's `MEMORY.md` system instead — see
the table below.

### 4. End of a substantive session — *"checkpoint this"*  ← **the actual habit**

One call (`mempalace_checkpoint`) files every item and writes the diary entry,
with semantic dedup at 0.9 built in, rendering as a single tool card:

```
items: [{ wing: "curated",
          room: "decisions" | "incidents" | "ops" | "how-it-works",
          content: "<verbatim — never summarised>" }, …]
diary: { agent_name: "claude-code", entry: "<AAAK>", topic: "…" }
```

What earns a checkpoint item:
- the decision **and why** — especially why the alternatives were rejected
- dead ends: what you tried that did **not** work, so it isn't retried in October
- any fact that cost more than an hour to establish
- corrections: "we believed X; X is wrong because Y"

What does **not**: anything Graphify can answer (call graphs, definitions),
routine CRUD, or a restatement of the diff.

### 5. When a fact changes — *"supersede: ..."*
Single-valued facts (a version, an owner, a status, "the fix is in PR #N") change
constantly. `kg_supersede` replaces atomically at one boundary; hand-rolling
invalidate+add leaves both values true at that boundary. This is the mechanism
`MEMORY.md` currently emulates by hand with "⚠️ the old note is stale" markers.

---

## What goes where

| Store | Holds | Survives a rebuild? |
|---|---|---|
| `MEMORY.md` + `memory/*.md` | ONE durable fact per file, auto-loaded every session | ❌ container overlay — but `backup-memory.sh` mirrors it to `/workspace`, and `seed.sh` mines it as wing `memory` |
| Palace wing `curated` | The longer **why**: decisions, rationale, dead ends | ✅ Postgres, cross-machine |
| Palace mined wings | Raw transcripts + all docs | ✅ auto |
| **Graphify** | Code structure — what calls what | ✅ regenerated |

---

## Weekly upkeep (~5 minutes)

```bash
bash mempalace/seed.sh            # incremental; dedups, so re-runs are cheap
bash mempalace/backup-memory.sh   # 292 files off the volatile overlay
mempalace status                  # sanity: drawer count still growing
```

## After a devcontainer rebuild — in this order

```bash
bash mempalace/setup.sh                    # CLI + plugin + hook + symlink
bash mempalace/set-dsn.sh                  # password + fork check
bash mempalace/attach.sh                   # local marker — else "No palace found"
bash mempalace/backup-memory.sh --restore  # additive; never overwrites newer files
# then RELOAD the VS Code window so MCP tools + hooks load
```

## Gotchas that will bite

- ⚠️ **`mempalace_checkpoint`'s `diary` param firing does NOT mean the `items`
  filed.** They're independent parts of one call — diary writes a raw AAAK
  journal line every time it's given one; `items` is what actually lands in
  `curated`. Audited 2026-08-24: diary had 529 entries, `curated` had **zero** —
  the habit had only ever been half-exercised. Always pass both, and check
  `mempalace_list_rooms(wing="curated")` occasionally to confirm items are
  actually accumulating, not just diary noise.
- ⚠️ **Never `mempalace sync --apply` on `claude-sessions`.** It prunes drawers whose
  source files are gone — and the June transcripts *are* gone. It would delete the
  only surviving copy of that period.
- `--max-chunks-per-file` **skips an entire file** that exceeds the cap; it does not
  truncate. A low cap silently discards your richest sessions.
- `mempalace status` saying *"No palace found"* after a rebuild means the local
  marker is missing, not that the palace is lost. Run `attach.sh`.
- L1 of `wake-up` is suppressed by default (`MEMPALACE_WAKEUP_L1=1` restores it) —
  measured as ~700 tokens of mid-sentence fragments in both scoped and unscoped form.
