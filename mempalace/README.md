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

## Layout

```
mempalace/
├── setup.sh    # idempotent installer — run after each devcontainer rebuild
├── seed.sh     # mine Claude sessions + ai-context + every docs/ folder
├── README.md   # this file
└── state/      # ← ~/.mempalace symlinks here (palace data + config + model)
                #   persists across rebuilds because /workspace is a host bind
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

## Hooks (what fires automatically once the plugin is installed)

- **Stop** — saves conversation context ~every 15 messages (fires at each
  turn-end; watch for latency — this is the main "is it worth it" signal).
- **PreCompact** — preserves memories before context compaction.

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

- [x] Installed `mempalace` (`[pgvector]` extra) via `uv tool`
- [x] `~/.mempalace` → `state/` symlink, embedding model pinned to `minilm`
- [x] Claude Code plugin installed (user scope) — automated in `setup.sh`
- [x] Scope decided: **memory + docs** (Graphify owns code structure)
- [x] Backend: **shared self-hosted pgvector** on the tailnet (namespace
      `andre-shared`) — Windows PC + MacBook connected. See `shared-state-plan.md`.
- [x] Palace seeded into `andre-shared`: Claude sessions + ai-context + all
      `docs/` (local-dev-env, infrastructure, per-repo). No raw source.
- [ ] Reload VS Code window to load MCP server + hooks into the live session
- [ ] Verdict: _TBD after a week of real use_
