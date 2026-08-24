# MemPalace — personal trial

A time-boxed evaluation of [MemPalace](https://github.com/MemPalace/mempalace)
(MIT, open-source, local-first AI memory) wired into Claude Code for my work in
`local-dev-env`. **Personal infra, but shared across my own environments.** The
palace is a self-hosted Postgres + `pgvector` backend reachable over my personal
Tailscale tailnet, so AI-session memory is captured once and recalled from any of
my machines/devcontainers (Windows PC, MacBook). No Rock of Eye AWS infra and no
third-party cloud is involved — see [`shared-state-plan.md`](shared-state-plan.md)
for the full backend design and the **SHARED-PALACE INVARIANTS** (get them wrong
and an env silently forks into a new empty palace).

This `mempalace/` dir is tracked in the **`dotai`** repo (scripts, README, plans);
only `state/` — the palace data, `config.json`, and the DSN it holds — is
gitignored, so no credentials or memory text are ever committed.

> **Using it day to day → [`USAGE.md`](USAGE.md).** Three phrases ("palace check",
> "checkpoint this", "supersede: …"), the weekly upkeep, the post-rebuild order, and
> the gotchas that bite. The protocol is also injected into every session via
> `identity.txt`, so an agent knows it without being told.

## What it is

Stores conversation/doc text **verbatim** in a "palace" and retrieves by semantic
search. No API key, no SaaS: the backend is a self-hosted Postgres + `pgvector`
container (`mempalace-pg`) on my always-on Windows PC, tailnet-only — reached from
this devcontainer at `host.docker.internal:5432`, namespace `andre-shared`. A local
ChromaDB palace is kept only as an offline fallback. Integrates with Claude Code as
a plugin: an MCP server (33 tools), auto-save hooks, and slash commands/skills.

## Division of labour — MemPalace vs Graphify

This workspace already has **Graphify** (`/workspace/.codegraph/`), a
deterministic AST **code knowledge graph** (~30k nodes / ~50k edges:
`calls`, `imports`, `inherits`, `mixes_in`, `references`, …). The two tools are
**complementary, not competitors** — scope each to what it's uniquely good at:

| Question shape | Tool | Why |
|---|---|---|
| "what calls X / where is Y defined / what mixes in Z" | **Graphify** | exact graph traversal, no hallucination, always current, token-cheap |
| "why did we do X / what did we decide / what did that session conclude" | **MemPalace** | semantic recall of meaning, history, rationale — Graphify has none of this |

So MemPalace here is scoped to **memory + prose**, NOT raw source (that would
duplicate Graphify, but fuzzier and noisier). It mines:

- **Claude Code conversations** (`~/.claude/projects`) — the headline feature.
- **`ai-context`** — the main documentation repo (whole repo).
- **Every `docs/` folder anywhere under `/workspace`** — auto-discovered each run
  (local-dev-env, infrastructure, the per-repo `docs/`, and anything added later).
  Worktree duplicates are skipped via git-origin matching.

> **Infrastructure docs note:** the canonical `/workspace/infrastructure` mount is
> usually **empty** here (that volume is owned/populated by the infra
> devcontainer, not this one). `seed.sh` therefore prefers
> `/workspace/infrastructure/docs` when populated and otherwise falls back to the
> live infra **worktree** (`/workspace/infra-*-wt/docs`), always labelling the
> wing `infrastructure-docs`. We deliberately do **not** clone/seed that shared
> volume from here — it would risk clobbering the infra devcontainer's state.
> When the volume gets populated properly, a reseed auto-switches to it, same name.

If you ever miss "find code by description" semantic search, add a *curated* code
slice (Actions/Entities — never fixtures), don't re-mirror the tree.

## Memory model — MemPalace vs Claude `MEMORY.md` vs session files

Three places can hold "memory"; they layer, they don't compete. **MemPalace is
the system of record.**

| | Claude `MEMORY.md` | session files (`/workspace/session-*.md`) | **MemPalace** |
|---|---|---|---|
| Job | tiny always-on cache | polished human handoff | durable semantic recall (why / decisions / history) |
| Auto-loaded into context? | ✅ every session (it's the index) | ❌ only when pointed at one | ✅ via the **SessionStart wake-up hook** + on demand via `search` |
| Survives devcontainer rebuild? | ❌ container overlay — wiped | ✅ `/workspace` host bind | ✅ Postgres on the tailnet |
| Cross-machine? | ❌ | ❌ | ✅ namespace `andre-shared` |
| How content gets in | hand-written | hand-written | **auto-mined** from conversations + `ai-context` + every `docs/` |

Rules of thumb:
- **Default to MemPalace.** It mines your sessions automatically and is the only
  durable + cross-machine store. Recall with `mempalace search "…"`; the wake-up
  hook surfaces the essentials at session start without being asked.
- **Keep `MEMORY.md` lean** — only the handful of mistake-preventing / current-
  focus facts you want in front of the agent *every* session. It's a cache, not
  the archive (and it's wiped on rebuild). Back it up to `/workspace` if it holds
  anything not yet mined.
- **Session files are optional now** — their durable-handoff value is covered by
  MemPalace mining the conversation. Write one only when you want a curated
  human-readable artifact.

## Layout

```
mempalace/
├── setup.sh       # idempotent installer — run after each devcontainer rebuild
├── set-dsn.sh     # write the pgvector password (fail-closed) + verify no fork
├── attach.sh      # recreate the local marker after a rebuild (no re-seed)
├── backup-memory.sh  # mirror Claude's memory/ dir off the volatile overlay
├── USAGE.md       # ← THE DAILY HABIT: three phrases, weekly upkeep, gotchas
├── seed.sh        # mine Claude sessions + ai-context + every docs/ folder
├── identity.txt   # L0 "who you are" — committed template; setup.sh copies it into state/
├── hooks/
│   └── session-start.sh   # SessionStart wake-up hook (registered into settings.json by setup.sh)
├── README.md      # this file
└── state/         # ← ~/.mempalace symlinks here (palace data + config + model + live identity.txt)
                   #   gitignored; persists across rebuilds because /workspace is a host bind
```

## Why a symlink + re-runnable script

- `~/.mempalace` (config + palace) and `~/.local/bin` (uv tools) live in the
  **container home → wiped on devcontainer rebuild.**
- The palace **data** is the thing worth keeping, so `~/.mempalace` is symlinked
  to `state/` here under the persistent `/workspace` host bind.
- The **wiring** (uv install, plugin) is cheap to recreate, so it's all in
  `setup.sh` — re-run it after a rebuild; the data is untouched.

## Setup (fresh container)

```bash
bash /workspace/.ai/dotai/mempalace/setup.sh   # installs CLI + the Claude Code plugin
```

`setup.sh` now installs the Claude Code plugin too. The `claude` CLI isn't on
PATH (Claude Code runs as the VS Code extension), but the extension **bundles** a
usable binary at `~/.vscode-server/extensions/anthropic.claude-code-*/resources/
native-binary/claude`; the script resolves the newest one and runs
`plugin marketplace add` + `plugin install --scope user`. Re-run after a rebuild
(it wipes `~/.claude`); the palace data lives in Postgres, so nothing is lost.
`setup.sh` reads `state/config.json` and installs the matching backend driver —
`mempalace[pgvector]` plus the NUL-strip patch when the backend is `pgvector`,
else plain `mempalace`. (After a rebuild the CLI is gone, so re-running `setup.sh`
is what restores the `[pgvector]` extra — a bare `uv tool install mempalace`
misses it and `status` fails with a `psycopg` dependency error.)

> Plugin install needs network. If you run `setup.sh` from a fully sandboxed
> shell that can't resolve `github.com`, do the plugin step from a normal
> terminal (or in-session via `/plugin marketplace add MemPalace/mempalace`).

Then **reload the VS Code window** so the MCP server + hooks load, and seed:

```bash
bash /workspace/.ai/dotai/mempalace/seed.sh
```

## Config choices

| Setting | Value | Note |
|---|---|---|
| Embedding model | `minilm` (all-MiniLM-L6-v2, 384-dim, English) | pinned in `state/config.json`; must match byte-for-byte on every env sharing the palace |
| Backend | **self-hosted Postgres + `pgvector`** (namespace `andre-shared`) | container `mempalace-pg` on the Windows PC, tailnet-only; `host.docker.internal:5432` from here. ChromaDB remains as an offline fallback only. |
| Palace path | `state/palace-pg` | via the `~/.mempalace` symlink; the path is **hashed into the pgvector table name** — keep it identical across envs (see invariants in `shared-state-plan.md`) |

## Hooks (what fires automatically)

From the **plugin** (auto-save):
- **Stop** — saves conversation context ~every 15 messages (fires at each
  turn-end; watch for latency — this is the main "is it worth it" signal).
- **PreCompact** — preserves memories before context compaction.

Added by **us** (proactive recall — the plugin doesn't ship this):
- **SessionStart** → `hooks/session-start.sh`, registered into
  `~/.claude/settings.json` by `setup.sh` (idempotent JSON merge that preserves
  any existing hooks, e.g. codegraph). It injects the `wake-up` primer (L0
  identity + L1 essential story) as `additionalContext` at the start of every
  session, so recall is **automatic** — no need to ask. It prefers the official
  `mempalace hook run --hook session-start` and falls back to emitting `wake-up`
  if that returns nothing. **Fail-open:** if the binary is missing or the palace
  backend is unreachable (offline / tailnet down), it emits nothing and never
  delays the session. Because `~/.claude` is wiped on rebuild, `setup.sh`
  re-registers it every run.

## Identity (L0)

`wake-up`'s first block is your identity, read from `~/.mempalace/identity.txt`.
The committed template lives at `mempalace/identity.txt`; `setup.sh` copies it
into the gitignored `state/` (`cp -n`, never clobbering a local edit). Keep it to
**durable** facts (who you are, role, environment, working preferences, team) —
*current* work belongs in the palace + the Claude `MEMORY.md`, not here.

## Evaluate

```bash
mempalace status                       # wings / rooms / drawer counts
mempalace search "trunk based deploys staging tag rollout"
mempalace search "terraform best practices sandbox cost cap"
mempalace search "why did we choose downstream staging promotion"
mempalace wake-up                      # ~600-900 token session primer
```

In a Claude Code session, the `mempalace` MCP tools and `/mempalace:*` commands
should also be available. For *code structure* questions ("what calls X") use
Graphify, not MemPalace — see "Division of labour" above.

## Re-scoping the palace

There is **no wing-delete command** (`mempalace palace` only does
`set-embedder`). To change scope, wipe and rebuild:

```bash
rm -rf state/palace state/hallways.json state/tunnels.json state/locks
bash /workspace/.ai/dotai/mempalace/seed.sh   # config.json (embedder) is kept
```

> **pgvector backend:** the wipe above only clears the *local* Chroma artifacts.
> The live palace is in Postgres — re-scoping there means dropping the
> `mempalace_andre-shared_…` tables (or re-mining, which dedups), not deleting
> local files. It is shared across envs, so coordinate before wiping it.

`seed.sh` re-discovers `docs/` folders at run time, so re-running it after
cloning more repos / adding docs automatically widens coverage — no edits needed.

## Teardown (when the trial ends)

```bash
# remove the plugin inside a Claude Code session:
#   /plugin uninstall mempalace@mempalace
#   /plugin marketplace remove mempalace
uv tool uninstall mempalace
rm -f ~/.mempalace                     # the symlink only
rm -rf /workspace/.ai/dotai/mempalace  # data + scripts
# restore a backed-up real config dir if one existed:
[ -d ~/.mempalace.bak ] && mv ~/.mempalace.bak ~/.mempalace
```

## Status

- [x] Installed `mempalace` (`[pgvector]` extra) via `uv tool` — **3.7.1**
- [x] `~/.mempalace` → `state/` symlink, embedding model pinned to `minilm`
- [x] Claude Code plugin installed (user scope) — automated in `setup.sh`
- [x] **SessionStart wake-up hook** — proactive recall, auto-registered, fail-open
- [x] **L0 identity** + the memory protocol (`identity.txt`), injected every session
- [x] Scope decided: **memory + docs** (Graphify owns code structure)
- [x] Backend: **shared self-hosted pgvector** on the tailnet (`andre-shared`)
- [x] Palace seeded: Claude sessions + `ai-context` + all `docs/`. No raw source.

### 2026-08-19 — restored after a silent seven-week outage

The palace stopped receiving writes on **2026-06-28** — from *every* machine — and
nothing surfaced it until it was checked on 2026-08-18. A devcontainer rebuild had
removed the CLI, the plugin, the hook and the `~/.mempalace` symlink; the fail-open
hook then made a dead palace indistinguishable from a healthy one.

What that outage taught, now fixed:

- [x] **Staleness guard** in `hooks/session-start.sh` — warns in-session when the
      newest drawer is older than `MEMPALACE_STALE_DAYS` (7), and when the drawers
      table is missing entirely (invariant drift / fork). Fail-open, ~4s budget.
- [x] **`set-dsn.sh`** — fail-closed secret write (an empty `op read` once wrote a
      0-char password and reported success) + the fork check.
- [x] **`attach.sh`** — the marker step a rebuilt env needs before the CLI can see
      the palace at all.
- [x] **`backup-memory.sh`** — Claude's `memory/` dir (292 files) lives on the
      container **overlay**, not `/workspace`; a rebuild deletes it. Now mirrored to
      the gitignored `state/memory-backup/`, independent of MemPalace being up.
- [x] **NUL patch retired** — upstream 3.7.1 sanitises NUL *and* lone surrogates
      (`_strip_nul` / `strip_lone_surrogates`, issues #1829/#1833).
- [x] **`memory/` mined as its own wing** so `--wing memory` is curated-only.
- [x] **`wake-up` L1 suppressed** — measured ~700 tokens of mid-sentence fragments,
      no better when wing-scoped. Primer is now ~660 tokens, identity + protocol.

### Verdict (2026-08-19)

**The archive earns its keep; the daily-recall layer had not — yet.** Local
transcripts only reach back to 2026-07-19, so the palace is the *only* surviving
record of everything before that, and it demonstrably holds knowledge that was
later re-derived from scratch. Against that: seven weeks of real shipping happened
without it, on `MEMORY.md` alone, unnoticed.

So the trial continues on changed terms — **deliberate capture** (`USAGE.md`) rather
than passive mining, with the staleness guard making a second silent death visible.
Re-assess after a fortnight of the checkpoint habit.

### 2026-08-24 — the checkpoint habit was half-exercised, not absent

Audited the live palace instead of assuming the 2026-08-19 protocol was working:
wing `curated` had **zero drawers** and the knowledge graph had **zero
entities/triples** — despite `mempalace_checkpoint` firing constantly (529 diary
entries). Root cause: the checkpoint tool's `diary` param and `items` param are
independent; only `diary` was ever being populated, so "checkpoint this" was
writing a raw journal line, never filing the durable fact into `curated`. See the
gotcha in `USAGE.md`.

Fixed by filing two real backfilled decisions (ssm-tunnel preview access,
ENG-2371 prod-tag-no-longer-autodeploys) as worked examples with both `items`
*and* two `kg_supersede` calls, and by adding "Does this reach future sessions
automatically?" to `USAGE.md` — the write-is-automatic / read-is-never-automatic
distinction wasn't written down anywhere before this.
