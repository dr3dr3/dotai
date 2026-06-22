# MemPalace shared state across machines & dev-envs — plan

**Goal:** one shared MemPalace palace so AI-session memory is captured routinely and
recall works from any of my environments — 2× local-dev-env on the Windows PC, the
MacBook M5's local-dev-env, and other devcontainers — without losing in-flight context
on PC restart / devcontainer rebuild. Personal use only; **no Rock of Eye AWS infra.**

## Decisions (2026-06-22)

- **Backend: self-hosted Postgres + `pgvector` in a Docker container on the always-on
  Windows PC**, reachable over my personal Tailscale tailnet. **Pivoted from the TrueNAS
  (2026-06-22)** to skip NAS setup pain — the Windows PC is already on the tailnet, always
  on, and AI can drive its Docker setup. Same data-governance win as the NAS plan
  (self-hosted, hardware I control, tailnet-only — not Neon/cloud); the palace text already
  lived on this PC, so no new exposure beyond the tailnet port. $0 running cost.
- **Recall, not literal resume.** No syncing of raw `~/.claude/projects/*.jsonl` across
  machines. Each env points its mempalace at the shared backend; `wake-up`/`search`
  reconstructs context and I start a fresh session. (Cross-machine `claude --resume` is
  unsupported/fragile anyway.)

## STATUS (2026-06-22) — Phase 1–3 DONE on the Windows PC

- **Server up:** `pgvector/pgvector:pg16` container `mempalace-pg` on the Windows PC,
  volume `mempalace-pgdata`, `restart: unless-stopped`. Files in `C:\Users\andre\mempalace-pg\`.
  PostgreSQL 16.14, pgvector 0.8.3. Creds in 1Password item "MemPalace pgvector" (Private vault).
- **Tailnet:** tailnet `goby-trout.ts.net`; this PC = `mango` / `100.108.239.14`;
  MacBook = `drem5` / `100.103.130.52`. Firewall allows 5432 only from the tailnet CGNAT
  range + Docker/WSL host-internal; LAN + internet default-denied.
- **Reach:** this devcontainer → `host.docker.internal:5432` (no Tailscale needed locally,
  verified). Mac → `mango.goby-trout.ts.net:5432` over tailnet (still needs the in-container
  sidecar — Phase 2 below, the only remaining unknown).
- **This env wired (config-driven, no flags):** `~/.mempalace/config.json` (gitignored,
  mode 600) sets `backend=pgvector`, `palace_path=~/.mempalace/palace-pg` (separate dir —
  the backend refuses to mix with the old chroma palace's artifacts), `pgvector_dsn` (holds
  the password), `pgvector_namespace=andre-shared`, `embedding_model=minilm`. So `status`/
  `search`/`mine`/`seed.sh`/the auto-mine hooks all hit pgvector with zero flags.
- **pgvector extra + NUL patch:** `uv tool install 'mempalace[pgvector]'` for psycopg, then
  `patch-pgvector-nul.py` (wired into `setup.sh`) strips NUL (0x00) bytes that Chroma
  tolerated but Postgres text/jsonb reject — convo transcripts contain them. Upstream bug in
  mempalace 3.4.1 (latest); remove the patch once fixed upstream.
- **Seeded:** re-mined (no cross-backend migrate exists) into the `andre-shared` namespace —
  all docs wings + the claude-sessions (conversations) wing. Old local chroma palace kept as
  an offline cache at `~/.mempalace/palace`.

## Why this is sound

- **Concurrency-safe by design.** mempalace's pgvector backend uses Postgres advisory
  locks to serialize HNSW index builds across clients, and dedups drawers by content —
  so multiple envs/machines writing the same palace concurrently is fine. (A real DB
  server is the whole reason this beats file-syncing a ChromaDB SQLite+HNSW file.)
- **Auto-schema.** mempalace runs `CREATE EXTENSION IF NOT EXISTS vector`,
  `CREATE TABLE … embedding vector(384)`, and the HNSW index itself.
- **Tailnet-only.** Postgres is never on the public internet; only my tailnet devices
  reach it. This is the "make remote safer" answer: remote ≠ unsafe, *third-party cloud*
  is the risk — self-host removes it.

## Architecture

```
  Windows PC                         MacBook M5
  ├─ local-dev-env #1 ─┐             └─ local-dev-env ─┐
  ├─ local-dev-env #2 ─┤  (each devcontainer)          │
  └─ other devcontainers┘                              │
        │  mempalace[pgvector], MEMPALACE_BACKEND=pgvector
        │  same namespace + same embedding model (minilm/384)
        ▼  via Tailscale (tailnet-only)
  ┌─────────────────────────────────────────────────┐
  │ TrueNAS SCALE                                    │
  │  └─ Postgres + pgvector container  (db: mempalace)│
  │     reachable at  nas.<tailnet>.ts.net:5432      │
  │  └─ ZFS snapshots = palace backups               │
  └─────────────────────────────────────────────────┘
```

## Phases

### Phase 0 — local session durability (optional safety net, per env)
Independent of the backend. Persist `~/.claude/projects` to a host-bind in each env (like
the palace symlink) so a rebuild/restart doesn't nuke the raw jsonl before it's mined.
With the shared backend this is just a last-mile guard (if the NAS is down mid-session and
you rebuild, you can re-mine later). Skip if you don't care about that edge.

### Phase 1 — stand up Postgres+pgvector on the NAS
- TrueNAS SCALE app/container, image `pgvector/pgvector:pg16` (pgvector preinstalled).
- Create db `mempalace`, role `mempalace` (give it CREATE on the db; superuser-or-pre-
  enable so `CREATE EXTENSION vector` succeeds — or run `CREATE EXTENSION vector` once as
  admin).
- Persist the data dir on a ZFS dataset; schedule periodic snapshots (= free backups).
- Do **not** expose 5432 to LAN/public — bind to the tailnet interface / firewall to it.

### Phase 2 — tailnet exposure + the reachability SPIKE (the main unknown)
- Put the NAS on the tailnet (TrueNAS Tailscale app), confirm `nas.<tailnet>.ts.net`
  resolves and `psql` works **host→NAS** first.
- Then the real test: reach it **from inside a devcontainer**. Preferred approach —
  a **Tailscale userspace sidecar in the devcontainer**: `tailscaled
  --tun=userspace-networking` + `tailscale up --authkey=<ephemeral, tagged, pre-approved>`
  (key from 1Password). Ephemeral nodes auto-clean on container teardown.
  - Fallback to evaluate: host-routed reach (Docker Desktop) if the host's tailnet is
    routable into the container — simpler if it works, but less reliable.
- ✅ Gate: `psql "$MEMPALACE_PGVECTOR_DSN" -c 'select 1'` succeeds inside the container.
  Don't roll out further until this passes.

### Phase 3 — point THIS env at the shared backend + seed
- `uv tool install 'mempalace[pgvector]'` (adds the psycopg/pgvector driver).
- Env (this env first):
  - `MEMPALACE_BACKEND=pgvector`
  - `MEMPALACE_PGVECTOR_DSN=postgresql://mempalace:<pw>@nas.<tailnet>.ts.net:5432/mempalace`
  - `MEMPALACE_PGVECTOR_NAMESPACE=andre-shared`   ← SAME on every env = shared palace
  - embedding model stays `minilm` (already pinned) — must match everywhere (384-dim).
- Seed (no cross-backend migrate exists → re-mine into pgvector):
  `mempalace mine ~/.claude/projects --mode convos --agent andre-winpc-env1`
- Keep the local ChromaDB palace as an offline cache, or retire it.
- ✅ Verify: `mempalace status` (against pgvector) shows the wings; from a *second* env,
  a search returns drawers written by the first.

### Phase 4 — bake into dotai so every env self-configures
- Evolve `setup.sh`: if `MEMPALACE_PGVECTOR_DSN` is present → install `mempalace[pgvector]`
  and use the shared backend; else fall back to local Chroma (good for offline/airgapped).
- Pull `DSN` + the Tailscale ephemeral auth key from **1Password via varlock** (no creds on
  disk). Pin `minilm`. Set `--agent` per machine/env for provenance.

### Phase 5 — roll out
local-dev-env #2 (same PC) → MacBook local-dev-env → other devcontainers. Each: run
`setup.sh`, confirm the Phase-2 gate, done.

## Routine updating (already automatic)
The plugin's **Stop** (every ~15 msgs) and **PreCompact** hooks auto-mine sessions on save
→ they write straight to pgvector once the env vars are set. Optional: a periodic
`mempalace mine ~/.claude/projects --mode convos` (cron / `MEMPAL_DIR` auto-mine) as a belt.

## Open items / things to confirm
- **Data-governance gut-check:** RoE-derived session text will live on my personal NAS.
  Most defensible non-work home (self-hosted, encrypted, tailnet-only), but worth a
  conscious OK against any RoE data policy.
- **NAS uptime:** NAS down → that env's mines fail (hooks log errors); nothing lost if the
  raw jsonl persists (Phase 0) — re-mine when back. Accept, or add a tiny "skip if backend
  unreachable" guard.
- **Namespace strategy:** single `andre-shared` namespace = everything merges. Could split
  personal vs roe-work into separate namespaces later if I ever want to keep them apart.
- **TrueNAS edition:** assumes **SCALE** (runs containers). CORE (FreeBSD) would need a
  jail/VM for Postgres instead.
- **Secrets:** DSN (incl. password) + Tailscale auth key → 1Password; varlock injects.
```
Backend env-var reference (pgvector):
  MEMPALACE_BACKEND=pgvector
  MEMPALACE_PGVECTOR_DSN=postgresql://USER:PW@HOST:5432/mempalace
  MEMPALACE_PGVECTOR_NAMESPACE=andre-shared
  MEMPALACE_EMBEDDING_MODEL=minilm        # or state/config.json
install: uv tool install 'mempalace[pgvector]'
```
