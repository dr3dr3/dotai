# Harness contract (profiles)

This is the **pluggable seam**. The sandbox substrate is harness-agnostic: it sets up a
clean, network-gated, secret-reduced box with the codebase and a knowledge graph, then
**execs a harness you choose**. Swapping `claude-code` → `codex` → `pi` (or a future
harness) changes *only* a profile — the substrate code never changes.

The agent **workflow** (prompts, task loops, what the agent actually does) is **not**
defined here. It lives inside whatever `HARNESS_CMD` is. A profile only bootstraps the
binary.

## A profile = one `.env` + one config dir

```
profiles/
├── claude-code.env          # the profile (this file's schema below)
├── codex.env
├── pi.env
└── config/
    ├── claude-code/         # staged into HARNESS_CONFIG_DST before exec
    ├── codex/
    └── pi/
```

### `<name>.env` schema

| Var | Required | Meaning |
|-----|----------|---------|
| `HARNESS_CMD` | yes | binary the substrate execs (must be on `PATH` in the image) |
| `HARNESS_ARGS` | no | args passed to it. Default profiles use `--version` as a wiring proof; a real deployment sets the workflow entrypoint here |
| `HARNESS_CONFIG_SRC` | no | dir under `sandbox/` copied into `HARNESS_CONFIG_DST` before exec |
| `HARNESS_CONFIG_DST` | if SRC set | where to stage config (e.g. `~/.claude`) |
| `SANDBOX_RUN_WRAPPER` | no | inner-sandbox wrapper prefix (e.g. sandbox-runtime). **Required for Pi** |

**Profiles are committed, non-secret config.** Never put a token in a profile — secrets
arrive only through the [two-phase flow](../README.md#two-phase-model).

## What the substrate guarantees to the harness (the inputs)

In the agent phase these env vars are always present:

| Var | Meaning |
|-----|---------|
| `SANDBOX_WORKDIR` | the cloned, read-only codebase (`roe-codebase/`) — also the cwd |
| `SANDBOX_GRAPH_DIR` | the built Graphify knowledge graph |
| `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY` | the egress allowlist gate |
| `SANDBOX_RO_TOKENS` | path to the read-only integration tokens file (already sourced) |
| `SANDBOX_AUDIT_GROUP` | CloudWatch audit group (`/roe/sandbox/audit`) |
| `SANDBOX_PROFILE` / `SANDBOX_ENV` | which profile / `local`\|`fargate` |

The harness **must not assume any write or push credential exists** — that is the
trifecta guarantee. Available tokens are read-only (Sentry/Linear/Slack) plus the
single sanctioned write-channel (`AGENTMAIL_API_KEY`, gated by agent-email).

## Adding a new harness

1. Install its CLI in [`../image/Dockerfile`](../image/Dockerfile) (the sandbox image —
   self-contained, separate from the general-purpose `.devcontainer/`).
2. Add `profiles/<name>.env` and `profiles/config/<name>/`.
3. Run with `SANDBOX_PROFILE=<name>`. Done — no substrate changes.

## Per-harness notes

- **claude-code** — has its own permission system; container + proxy suffice. The staged
  `settings.json` deny-list (reused from the repo default) is defense-in-depth.
- **codex** — has its own sandbox/approvals; honours `HTTP(S)_PROXY`.
- **pi** — ⚠️ **no built-in permission system.** Its profile sets `SANDBOX_RUN_WRAPPER`
  to wrap it in Anthropic `sandbox-runtime` (filesystem confined to the cwd). Do not run
  Pi without that wrapper.

## Known caveat — Linear

Linear API keys have no clean read-only scope, so `LINEAR_TOKEN` is **read-only by
convention** in v1: the harness profile must not invoke Linear write tools. This is a
real (small) trifecta hole — the documented fix is a read-only OAuth actor. Tracked as a
follow-up, not closed in this foundation.
