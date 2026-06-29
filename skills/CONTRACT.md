# Modular Skills — Contract

> **Status: spec v0.1 — not yet implemented.** We prove it out by *extraction* (refactor
> Idea Wrangler's inline steps into real skills) once the sandbox Tier-1 tests are green.
> This document is the target the extraction builds toward, and the reference for any new
> skill. Existing skills (`agent-email`, the `analyse-*` set, etc.) predate it and will be
> reviewed/aligned in a later cleanup — see [Migration](#migration).

## Why this exists

We build **modular skills** — small, reusable units of work — and compose them two ways:

- **Synchronously**, in a chat session: you (or Claude) invoke a skill on demand.
- **Asynchronously**, in an agent: a runner executes an ordered **pipeline** of skills,
  unattended, inside the [AI Sandbox](../sandbox/).

The same skill serves both. The async path is **code-orchestrated** (a runner controls each
step) — deliberately, because that is the only way to do the things that matter for
autonomous runs: **pick a fit-for-purpose model per step**, timebox each step, validate
inputs/outputs, audit, and resume.

## Vocabulary

| Term | Meaning |
|------|---------|
| **Skill** | A reusable unit of work: a directory with a manifest + instructions (+ optional script). |
| **Artifact** | A named, typed file produced/consumed by skills (e.g. `findings`, `concept`). |
| **Blackboard** | The per-run directory where artifacts live; how skills hand off. |
| **Pipeline** | An ordered list of skills that make up an agent's run. |
| **Run** | One execution of a pipeline, with its own blackboard + `state.json`. |
| **Orchestrator** | The runner that executes a pipeline: validates contracts, selects models, audits. |

## Two modes, one skill (dual use)

A skill's **`SKILL.md`** describes the capability generically ("given a seed, produce
findings") — that's what a chat session loads and what the model follows. A skill's
**`skill.json`** adds the *machine contract* (typed inputs/outputs, model, timeout) the
orchestrator needs. **Synchronous use ignores `skill.json`;** the orchestrator uses both.
Write `SKILL.md` so it reads sensibly with or without injected paths — that's the bridge.

## The blackboard (run envelope)

Each run gets a directory. Skills never pass data ad-hoc; they read and write **named
artifacts** here. This gives free auditability and resumability.

```
/work/runs/<run_id>/
  inputs/      seed.json                      ← read-only entry artifact(s)
  context/     strategy.md non-goals.md …     ← standing context, mounted read-only
  artifacts/   findings.json jtbd.json premortem.json … concept.md   ← what skills produce
  state.json   ← the artifact registry + step log (the run's spine)
```

### `state.json`

The registry maps **logical artifact names → paths** (skills refer to artifacts by name,
not path — decoupling them from layout), and logs every step including **which model ran
it** (for cost/debug):

```json
{
  "run_id": "20260624T0153Z-abc123",
  "pipeline": "idea-wrangler",
  "created": "2026-06-24T01:53:00Z",
  "artifacts": {
    "seed":           { "path": "inputs/seed.json",            "schema": "seed",           "by": "brain-fart" },
    "findings":       { "path": "artifacts/findings.json",     "schema": "findings",       "by": "research-with-provenance" },
    "jtbd":           { "path": "artifacts/jtbd.json",         "schema": "jtbd",           "by": "jtbd-restate" },
    "premortem":      { "path": "artifacts/premortem.json",    "schema": "premortem",      "by": "pre-mortem" },
    "sizing":         { "path": "artifacts/sizing.json",       "schema": "sizing",         "by": "rice-sizing" },
    "recommendation": { "path": "artifacts/recommendation.json","schema": "recommendation","by": "recommend" },
    "concept":        { "path": "artifacts/concept.md",        "schema": "markdown",       "by": "compose-concept" }
  },
  "steps": [
    { "skill": "kill-fast-gate",           "model": "claude-haiku-4-5",  "status": "ok",     "ms": 1100 },
    { "skill": "research-with-provenance", "model": "claude-sonnet-4-6", "status": "ok",     "ms": 48000 },
    { "skill": "recommend",                "model": "claude-opus-4-8",   "status": "pending" }
  ]
}
```

## A skill is a directory

```
skills/<id>/
  skill.json     # the machine contract (manifest)
  SKILL.md       # model-facing instructions (also used in chat) — the "how"
  run.mjs        # OPTIONAL — only for script-type skills (deterministic, no model)
```

### `skill.json` (manifest)

```json
{
  "id": "research-with-provenance",
  "version": "1",
  "model": "claude-sonnet-4-6",          // fit-for-purpose DEFAULT; a pipeline may override
  "timeout_secs": 300,
  "reads":          ["seed", "context"], // required input artifacts — must exist or step errors
  "optional_reads": ["sentry"],          // degrade gracefully if absent (skill notes the gap)
  "writes":         ["findings"],        // must be produced or the step fails
  "entry": { "type": "claude", "prompt": "SKILL.md" }
}
```

`entry.type`:
- **`claude`** — the orchestrator runs the model with `SKILL.md` as guidance. Use for
  reasoning/research/synthesis (most skills).
- **`script`** — the orchestrator runs `run.mjs`. Use for deterministic work with no model
  (e.g. `emit-to-linear`). Set `"model": null`.

### `SKILL.md`

Plain model-facing instructions for the capability. Reference artifacts by their **logical
names** ("read the `seed`", "write `findings`"), not paths. Keep it self-contained so it
also works when a human invokes it in chat.

## Calling convention

The orchestrator runs each step like this:

1. Resolve `reads`/`optional_reads`/`writes` (logical names → paths via the registry);
   error if a required `read` is missing.
2. Resolve the model: pipeline override → `skill.json` default.
3. Set env for the skill: `RUN_DIR`, `SKILL_IO` (JSON of resolved paths), `SKILL_MODEL`.
4. Invoke:
   - **claude**: `claude -p "<task wrapper: your inputs are at these paths; write these
     outputs; then stop>" --append-system-prompt "$(cat SKILL.md)" --model "$SKILL_MODEL"
     --add-dir "$RUN_DIR"` (run unattended per the sandbox's permission posture).
   - **script**: `node run.mjs` (reads `RUN_DIR` / `SKILL_IO` from env).
5. Verify every declared `write` now exists (and parses, if JSON). Missing → step fails.
6. Record model/duration/status in `state.json` + emit an audit line.

The orchestrator injects *where*; `SKILL.md` supplies *how*. That separation is what keeps
skills dual-use.

## Canonical artifact schemas

Schemas live in `skills/schemas/<name>.schema.json`. Three are load-bearing:

### `seed` — the entry artifact (produced by `/brain-fart`)
Already defined: [`seed.schema.json`](../agents/idea-wrangler/seed.schema.json) (moves to
`skills/schemas/` during extraction). The synchronous `/brain-fart` skill's whole job is
"emit a valid `seed`".

### `findings` — the keystone
Provenance is **first-class**, so any skill can consume findings and the
source+confidence rule is enforced by the schema, not by prose:

```json
{ "findings": [
  { "id": "f1",
    "claim": "We already store structured fitting data",
    "source": "codebase",            // codebase | docs | linear | sentry | web | assumption
    "confidence": "high",            // low | med | high
    "evidence": "Modules/Fitting/Models/Fitting.php:42",
    "refs": [] }
]}
```

### judgement artifacts — one per skill
Per the [one skill, one artifact](#one-skill-one-artifact) rule, the judgement is **not** a
single shared `assessment` object. Each reasoning skill owns its own small artifact, and
`compose-concept` reads them all:

```json
// jtbd        (by jtbd-restate)
{ "jtbd": "When …, [someone] wants to …, so they can …",
  "assumptions": [ { "text": "…", "load_bearing": true, "would_have_to_be_true": "…" } ] }

// premortem   (by pre-mortem)
{ "failure_modes": [ { "failure_mode": "…", "likelihood": "med", "severity": "high", "conflicts_nongoal": false } ] }

// sizing      (by rice-sizing)
{ "tshirt": "M", "rice": { "reach": 3, "impact": 2, "confidence": 0.6, "effort": 3, "score": 1.2 } }

// recommendation (by recommend)
{ "verdict": "park", "strongest_for": "…", "strongest_against": "…" }
```

### `concept` — a rendered VIEW, not working state
The human-facing `concept.md` is **rendered at the end** by a `compose-concept` skill from
`findings` + `jtbd` + `premortem` + `sizing` + `recommendation`. Keeping intermediates
structured (JSON) is what lets us validate, score, and reuse them; the Markdown is the final
projection. (This is the one change to Idea Wrangler today, where the model writes the doc
directly.)

## Pipelines

An agent declares its run as an ordered list with optional per-step overrides:

```json
{ "pipeline": "idea-wrangler", "steps": [
  { "skill": "kill-fast-gate",           "model": "claude-haiku-4-5" },
  { "skill": "research-with-provenance" },
  { "skill": "jtbd-restate" },
  { "skill": "pre-mortem" },
  { "skill": "rice-sizing",              "model": "claude-haiku-4-5" },
  { "skill": "recommend",                "model": "claude-opus-4-8" },
  { "skill": "compose-concept" },
  { "skill": "emit-to-linear" }
]}
```

## One skill, one artifact

Each skill **writes exactly one artifact** (it may *read* many). No two skills write the
same artifact. This is a hard rule, not a style preference:

- **Ownership is unambiguous** — `state.json` records exactly which skill produced each
  artifact; there's no "who wrote this / in what order" confusion.
- **Resume is clean** — "skip steps whose `writes` already exist" works because a write maps
  to one step. Shared/append artifacts would make resume ambiguous.
- **Composition stays explicit** — downstream skills (e.g. `compose-concept`) declare the
  several artifacts they read, rather than depending on a god-object assembled in order.

If a step seems to need to "add to" an existing artifact, that's the signal to split it into
its own artifact and have the consumer read both.

## Execution semantics

- **Validation** (v0.1, intentionally light): required `reads` exist; JSON `writes` parse;
  `schema` is a declared name. A full JSON-Schema validator is deferred.
- **Graceful degradation**: a missing `optional_read` is not an error — the skill notes the
  gap (e.g. "Sentry unavailable `[sentry, n/a]`") and continues.
- **Failure**: a step fails if it errors, times out, or doesn't produce its `writes`. Default
  = stop the pipeline; a step marked `"optional": true` in the pipeline lets the run continue.
- **Resume**: re-running skips steps whose `writes` already exist (or `--from <skill>`). The
  blackboard makes this trivial.
- **Audit**: every step start/end → [`sandbox/lib/audit.mjs`](../sandbox/lib/audit.mjs)
  (`/roe/sandbox/audit`) with `run_id`, `skill`, `model`, `ms`, `status`.

## Model selection guidance

The point of code-orchestration. Defaults in `skill.json`, overridable per pipeline step.

| Step kind | Model | Why |
|-----------|-------|-----|
| Gates, extraction, scoring (kill-fast, RICE) | `claude-haiku-4-5` | cheap, fast, mechanical |
| Research, synthesis, restatement | `claude-sonnet-4-6` | balance of cost and depth |
| Judgement / recommendation | `claude-opus-4-8` | the call that matters most |
| Deterministic (emit, render) | `null` (script) | no model needed |

## Where things live

| Path | What |
|------|------|
| `skills/<id>/` | reusable skills (dual-use: chat + pipeline) |
| `skills/schemas/` | canonical artifact JSON schemas |
| `agents/<name>/pipeline.json` | an agent's ordered skill list + overrides |
| `agents/<name>/` | agent-specific glue/config (not reusable skills) |
| `agents/_runner/` (TBD) | the shared orchestrator |

## Deliberately deferred (don't build yet)

Parallel / DAG execution (pipelines are linear for now) · a real JSON-Schema validation
engine · a skill registry/discovery service · cross-run artifact caching. Add these only
when a real pipeline needs them.

## Migration

Existing skills (`agent-email`, `analyse-*`, `tdd`, …) predate this contract. They keep
working as-is for chat use. During the planned skills review/cleanup we'll: add `skill.json`
to the ones worth orchestrating, move shared schemas into `skills/schemas/`, and leave
chat-only skills untouched. New skills follow this contract from the start.

## Worked example: Idea Wrangler

The extraction target. Today's inline system-prompt steps become skills:

```
seed (from /brain-fart)
  → kill-fast-gate        (haiku)   reads: seed, context                         writes: gate   ← short-circuits if dup/non-goal
  → research-with-provenance (sonnet) reads: seed, context, [sentry]             writes: findings
  → jtbd-restate          (sonnet)  reads: seed, findings                        writes: jtbd
  → pre-mortem            (sonnet)  reads: jtbd, findings, context               writes: premortem
  → rice-sizing           (haiku)   reads: jtbd, findings                        writes: sizing
  → recommend             (opus)    reads: jtbd, premortem, sizing, findings     writes: recommendation
  → compose-concept       (sonnet)  reads: seed, findings, jtbd, premortem, sizing, recommendation  writes: concept
  → emit-to-linear        (script)  reads: concept                              → email to Linear intake
```

Each row writes exactly one artifact; later steps read the several they need. `gate` (from
the kill-fast step) lets the pipeline short-circuit to `compose-concept` when the idea is a
duplicate or hits a non-goal.

`research-with-provenance` and `pre-mortem` are the most reusable — extract those first to
test whether the granularity and the contract feel right in both an agent run and a chat
session.
