# Idea Wrangler

An autonomous agent that turns one of Mark's vague product "brain-farts" (after André's
`/brain-fart` triage) into a structured, decision-ready **Idea Concept** — and files it
into Linear Triage for you and Mark to decide on.

It runs **one-shot** inside the [AI Sandbox](../../sandbox/): research → reason → write the
concept → email it to Linear → exit. No live Q&A; questions it has are written *into* the
concept.

## How it's wired (the security shape)

```
sandbox SETUP phase   clone repos (read-only) · emit read-only tokens
        │
        ▼  (env -i boundary — no write/push creds)
sandbox AGENT phase   SANDBOX_PROFILE=idea-wrangler → /opt/workload/run.sh
        │
        ├─ Claude one-shot, READ-ONLY: Linear(read) · Sentry(read) · codebase · docs
        │     → writes the Idea Concept to /work/out/concept.md   (NO send capability)
        │
        └─ emit.mjs → emails the concept to the Linear team intake address
                      → becomes a Triage issue (subject=title, body=description)
```

The model can only **read** and **write a local file**. The single external write is a
deterministic post-step that emails the finished concept to **one fixed internal address**
(your Linear intake), with secret redaction + audit. No web access. This keeps the
sandbox's "email is the only write-channel" guarantee intact.

## What you must fill in before the first real run

| Thing | Where | Why |
|-------|-------|-----|
| **Linear intake email** | [`config.json`](config.json) → `linear.intake_email` | the destination; without it `emit.mjs` fails loudly |
| **Sentry org/projects** | `config.json` → `sentry` | enables Sentry research (else it's skipped + noted) |
| **Standing context** | [`../../context/`](../../context/) `strategy.md` · `non-goals.md` · `roadmap.md` | grounding; empty = lower-confidence output |
| **Repos to research** | [`../../sandbox/repos.yaml`](../../sandbox/repos.yaml) | the codebase the agent checks against |
| **Tokens** | `.env.local` (local) / Secrets Manager (cloud) | `LINEAR_TOKEN`, `SENTRY_TOKEN`, `AGENTMAIL_API_KEY` |

> Get the Linear intake address from **Linear → Settings → Team → Intake** (enable
> email-to-issue). Mail sent there lands in that team's Triage queue.

## Input — the seed

The agent reads a typed JSON seed (the output of `/brain-fart`) from `$SANDBOX_INPUT`.
Schema: [`seed.schema.json`](seed.schema.json); example: [`seed.example.json`](seed.example.json).
Required fields: `raw_idea` (verbatim), `initial_read`, `why_mark_wants_it`,
`suspected_problems`, `must_investigate`. A missing/invalid seed **fails the run loudly** —
it never guesses.

## Run it (local, on the sandbox)

```bash
# from the repo root — one-shot
docker compose \
  -f sandbox/compose/docker-compose.yml \
  -f agents/idea-wrangler/compose.yml \
  run --rm agent
```

Swap in a real seed by pointing the seed mount (or `SANDBOX_INPUT`) at your file. To test
the reasoning without sending anything, set `IDEA_WRANGLER_EMIT=0` — it writes the concept
to `/work/out/concept.md` and skips the email.

## Output

A Linear Triage issue titled **`Idea Concept: <short name>`** with the 10-section body
(verbatim raw idea, JTBD, research with `[source, confidence]` tags, assumptions,
pre-mortem, sizing, recommendation, and a **blank decision section** for you and Mark). The
agent leaves priority/status alone.

## What to keep current

- **`../../context/`** — the agent is only as good as its grounding. Update strategy,
  non-goals, and roadmap as decisions are made (see [context/README](../../context/README.md)).
- **`config.json`** — intake address, Sentry projects, timebox.

## Known limits (by design)

- **No web research** this version (sandbox egress is locked down) — the concept notes
  where external market data would have helped.
- **Idempotency is supersede-by-reference** — email-to-intake always creates a *new* Triage
  item, so the agent searches Linear and references/supersedes a prior `Idea Concept: <name>`
  rather than editing it in place. You dedupe in Triage.
- **Linear is read-only by convention** — the token can technically write, but the agent
  only ever runs read queries; all writes go through the email channel.
