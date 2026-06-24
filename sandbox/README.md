# AI Sandbox

A reusable, hardened, containerized **substrate** for running autonomous AI coding
agents across our SDLC. One OCI image runs both **locally** (Docker/OrbStack) and on
**AWS ECS/Fargate**.

This directory defines the *sandbox only*. The agent **harness + workflow are
pluggable and out of scope** — you drop a harness in via a [profile](profiles/README.md)
and the substrate hands off to it. Different instances can run different harnesses.

## Why this exists

We want to delegate SDLC work to AI agents. Before wiring up any agent workflow we
need a strong, secure box for them to run in: our codebase + docs + context tooling
inside, read-only access to our systems, and hard guardrails so a compromised or
prompt-injected agent can't exfiltrate data or push code.

## Threat model — the "lethal trifecta"

A prompt-injected agent becomes a *breach* only when it simultaneously has all three:

1. **Private-data access** — our codebase, RO integration data (Sentry/Linear/Slack)
2. **Untrusted-content exposure** — issues, error payloads, web pages it reads
3. **External communication** — a channel to send data out

We can't remove (1) or (2) — that's the agent's job. So the substrate attacks **(3)**:

- **Egress allowlist** ([egress/](egress/)) — deny-by-default proxy; the agent can only
  reach a small set of known hosts. This is the keystone control.
- **No write credentials in the agent phase** — see the two-phase model below. Clone is
  read-only; there are no git push creds, and integration tokens are read-only.
- **One sanctioned write-channel** — `agent-email` (allowlist + redaction + audit). It
  is deliberately the *only* way the agent can emit content to a human, and it is
  tightly gated. See [skills/agent-email](../skills/agent-email/).

## Two-phase model

Borrowed from how cloud coding agents (e.g. Codex) separate provisioning from
execution. Secrets and network are available to **set up** the box; the **agent** then
runs in a reduced, locked-down environment.

```
┌── SETUP phase ──────────────────┐      ┌── AGENT phase ─────────────────┐
│ network: ON (still allowlisted) │      │ network: allowlist only         │
│ secrets: FULL                   │ ───► │ secrets: READ-ONLY tokens only  │
│ clone repos (RO), install,      │ env  │ no git push creds, no op:// sock│
│ build Graphify graph            │ -i   │ harness runs here               │
└─────────────────────────────────┘      └─────────────────────────────────┘
```

The boundary is a hard `exec env -i <curated allowlist>` in [entrypoint.sh](entrypoint.sh):
write-capable secrets are held only in the setup subshell and are **never placed in the
agent process's environment**. Only read-only tokens (written to a tmpfs file during
setup) cross into the agent phase.

## Layout

| Path | What it is |
|------|------------|
| [repos.yaml](repos.yaml) | Which codebases to clone (read-only) into `roe-codebase/` |
| [entrypoint.sh](entrypoint.sh) | PID 1 orchestrator; runs the phases; enforces the boundary |
| [phases/](phases/) | `00-secrets` → `10-setup` → `20-agent` |
| [lib/](lib/) | `audit.mjs`, `redact.mjs` (ported from `agent-email`) |
| [egress/](egress/) | Squid egress proxy + the domain allowlist |
| [profiles/](profiles/) | The **harness contract**: one `.env` + config dir per harness |
| [compose/](compose/) | Local run: agent on an internal network + Squid sidecar |
| [deploy/](deploy/) | AWS Fargate task definition + thin deploy scripts |

## Run it locally

Works the same on **Docker Desktop (Windows/WSL2)**, **OrbStack (macOS)**, and Linux —
the base compose mounts no host-specific paths.

```bash
# 1. Build the agent + egress-proxy images
bash sandbox/image/build.sh

# 2. Bring up the stack (agent on an internal network, all egress via the allowlist)
SANDBOX_PROFILE=claude-code docker compose -f sandbox/compose/docker-compose.yml up
```

**Secrets** for local runs come from a gitignored `.env.local` at the repo root (any OS),
or `-e KEY=value` on the CLI. On **macOS only**, you can instead resolve `op://` refs via
1Password by adding the overlay:

```bash
docker compose -f sandbox/compose/docker-compose.yml \
               -f sandbox/compose/docker-compose.mac.yml up
```

> **On Windows**, run these from a **WSL2** shell (bash + the Docker Desktop CLI). The
> sandbox runs Linux containers under Docker Desktop's WSL2 backend.

To verify the box end-to-end, run the test suite — see [test/](test/):

```bash
bash sandbox/test/smoke.sh         # Tier 0 — no Docker
bash sandbox/test/integration.sh   # Tier 1 — Docker; proves the live egress + boundary
```

See [compose/](compose/) for the local flow and [deploy/](deploy/) for Fargate.

## Isolation: what's built vs. deferred

**Built (v1):** hardened container (outer) · Squid egress allowlist · Anthropic
`sandbox-runtime` inner filesystem confinement (per-profile) · two-phase secret
boundary · read-only IAM task role on Fargate.

**Deferred (documented upgrade paths, not built):** microVM/gVisor isolation ·
TLS-intercepting proxy · in-container `iptables` owner-match egress lock · Terraform-
managed infra. These are the right next steps when we run *untrusted* code or go
multi-tenant; they are over-engineering for this foundation.
