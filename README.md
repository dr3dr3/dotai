# dotai — AI Developer Experience

This repo is a shared AI developer experience layer for your engineering team. It gives every
developer a consistent, opinionated starting point for AI-assisted work — pre-packaged context
documents, reusable slash commands, and setup scripts that wire everything into
[Claude Code](https://code.claude.com) automatically.

Think of it as dotfiles for Claude Code: it packages up the things Claude needs to understand
your engineering environment that it cannot infer from code alone.

> **Context documents and slash commands are complementary, not the same thing.** Context docs
> live in each individual repo's `CLAUDE.md` (and imported files). Slash commands (in
> `commands/`) are reusable prompts invoked with `/command-name` inside a Claude Code session.
> Both are wired in by the setup script.

---

## What's in here

```
dotai/
├── commands/                      ← Slash commands for Claude Code (/command-name)
│   ├── pr-summary.md              ← Generate a PR description following project conventions
│   ├── adr.md                     ← Scaffold an Architecture Decision Record
│   ├── review.md                  ← Review code against project-specific standards
│   └── test.md                    ← Generate tests following project testing conventions
├── templates/
│   ├── CLAUDE.md                  ← Base CLAUDE.md template — copy into individual repos and adapt
│   └── AGENT.md                   ← Equivalent for other AI tools (Cursor, Windsurf, Codex)
├── scripts/
│   ├── setup.sh                   ← Wire commands into Claude Code (and Cursor/Windsurf)
│   └── update.sh                  ← Pull latest and re-link
├── sandbox/                       ← AI Sandbox: hardened container for autonomous agents
│   ├── egress/                    ← Deny-by-default egress allowlist proxy (the keystone)
│   ├── phases/                    ← Two-phase run: setup (secrets) → agent (locked down)
│   ├── profiles/                  ← The harness contract (Claude Code / Codex / Pi, pluggable)
│   ├── compose/ + deploy/         ← Run locally (Docker/OrbStack) or on AWS Fargate
│   └── README.md                  ← Substrate overview + threat model
├── setup.sh                       ← Install AI tools (Claude Code, Codex, varlock, GitHub CLI)
└── README.md                      ← This file
```

> The **`sandbox/`** directory is a separate capability from the rest of this repo — a
> hardened container for running autonomous agents unattended. See the
> [AI Sandbox](#ai-sandbox) section below.

---

## Quick start

### Prerequisites

- [Anthropic account](https://claude.ai) — Claude Pro or Max subscription, or API key
- Bash-compatible shell (macOS, Linux, WSL)

### For repos using devcontainers

Add this to your `.devcontainer/devcontainer.json`:

```json
"postCreateCommand": "bash /workspace/.ai/dotai/setup.sh && bash /workspace/.ai/dotai/scripts/setup.sh"
```

Or, to always pull the latest from this repo first:

```json
"postCreateCommand": "curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/dotai/main/scripts/setup.sh | bash"
```

### For repos without devcontainers

Run both setup scripts once after cloning:

```bash
# 1. Install Claude Code CLI and GitHub CLI
bash .ai/dotai/setup.sh

# 2. Wire context + commands into Claude Code
bash .ai/dotai/scripts/setup.sh

# 3. Authenticate
claude auth login
gh auth login
```

To pull the latest context and re-link:

```bash
bash .ai/dotai/scripts/update.sh
```

---

## macOS host integration (OrbStack)

On the macOS host, AI agents are **not** installed — the host only boots
containers and holds secrets (see the
[dotfiles](https://github.com/dr3dr3/dotfiles) repo). This dotai devcontainer
wires three host integrations via `.devcontainer/devcontainer.json`:

| Integration | How | Why |
|-------------|-----|-----|
| **1Password** | bind-mount `agent.sock` + `SSH_AUTH_SOCK` remoteEnv | biometric `op`/`varlock` and `git push` in-container, no keys on disk |
| **Host share** | bind-mount `~/host-share` → `/host` (read-write) | edit host files from inside the container |
| **Host Ollama** | `OLLAMA_HOST=http://host.docker.internal:11434` | reach the host's native Ollama from the container |

> **Prerequisites:** enable 1Password ▸ Settings ▸ Developer ▸ *Use the SSH
> agent* (the socket must exist before boot), and `mkdir -p ~/host-share` on the
> host. Both are handled by the dotfiles `bootstrap-mac.sh`.

To add the same wiring to **another** project's devcontainer, drop this in its
`devcontainer.json` (adjust `remoteUser`/paths to match that image):

```jsonc
"mounts": [
  "source=${localEnv:HOME}/Library/Group Containers/2BUA8C4S2C.com.1password/t/agent.sock,target=/home/dev/.1password/agent.sock,type=bind",
  "source=${localEnv:HOME}/host-share,target=/host,type=bind,consistency=cached"
],
"remoteEnv": {
  "SSH_AUTH_SOCK": "/home/dev/.1password/agent.sock",
  "OLLAMA_HOST": "http://host.docker.internal:11434"
}
```

---

## How it works

Two setup scripts with distinct responsibilities:

### `setup.sh` (repo root) — installs AI tools

- **Claude Code CLI** via the official Anthropic installer (`curl -fsSL https://claude.ai/install.sh | bash`)
- **Codex CLI** (`@openai/codex`) — secondary agent (npm; needs Node)
- **varlock** — resolves `op://` secret refs into the env at launch (npm)
- **Pi Harness** (`@earendil-works/pi-coding-agent`) — self-extensible agent;
  installed `--ignore-scripts` per vendor docs. No built-in permission system,
  so the container is its sandbox. Point it at host Ollama via `models.json`.
- **GitHub CLI** (`gh`) for PR workflows

> These agents run **inside the container** by design — the macOS host stays
> agent-free and just boots the containers (see the host dotfiles repo). The
> dotai devcontainer also bakes Codex + varlock into its image.

### `scripts/setup.sh` — wires commands

1. **Copies** `commands/*.md` into `~/.claude/commands/` so they appear as `/command-name` slash commands in Claude Code
2. **Writes** a `CLAUDE.md` in the current repo if one does not exist yet (uses the template as a base)
3. **Writes** `.cursorrules` / `.windsurfrules` for Cursor/Windsurf if those tools are detected

Each repo's own `CLAUDE.md` contains context relevant to that codebase. Context lives in the repo
that owns it — not in a shared layer.

---

## AI Sandbox

The [`sandbox/`](sandbox/) directory is a **hardened, containerized substrate for running
autonomous AI agents** across the SDLC — work you delegate to agents that run unattended,
locally or in the cloud, rather than the interactive sessions you drive yourself.

It packages everything an agent needs (your codebase, a queryable knowledge graph,
read-only access to Sentry/Linear/Slack, and a guarded email channel) inside a box that is
locked down so a compromised or prompt-injected agent **cannot exfiltrate data or push
code**. The agent *harness and workflow are pluggable* — the sandbox is the box; what runs
inside it is configured per instance and is out of scope for the substrate itself.

> **This is separate from `.devcontainer/`.** The devcontainer is your general-purpose,
> interactive AI dev environment (you drive it, it has your credentials). The sandbox is a
> self-contained, unattended runtime with its **own image** ([`sandbox/image/Dockerfile`](sandbox/image/Dockerfile))
> and hard guardrails. Neither depends on the other.

|  | `.devcontainer/` | `sandbox/` |
|--|------------------|------------|
| **Purpose** | General-purpose interactive AI dev environment | Unattended runtime for autonomous agents |
| **Who drives it** | You | An agent harness + workflow (pluggable) |
| **Runs** | OrbStack on your machine | Local (Docker/OrbStack) **or** AWS Fargate |
| **Credentials** | Full (1Password, git push) | Read-only tokens only; no git push creds |
| **Entrypoint** | `bash` (interactive) | Two-phase, locked-down `entrypoint.sh` |

### Security model

The design target is the **"lethal trifecta"**: a prompt-injected agent becomes a breach
only when it has *private-data access* **and** *untrusted-content exposure* **and** an
*external-communication channel* at once. The sandbox attacks the third leg:

- **Egress allowlist (the keystone)** — a deny-by-default [Squid proxy](sandbox/egress/);
  the agent has no direct internet route and can only reach a small, reviewed set of hosts.
- **Two-phase run** — a **setup** phase (with secrets + network) clones the codebase
  read-only and builds context; then a hard `exec env -i` boundary drops every
  write-capable secret before the **agent** phase starts. No git push token, no `op://`
  resolution — only read-only integration tokens cross.
- **One sanctioned write-channel** — [`agent-email`](skills/agent-email/) (allowlist +
  secret redaction + audit) is deliberately the *only* way an agent emits content outward.
- **Read-only IAM on cloud** — on Fargate, the running agent's task role can do almost
  nothing (write audit logs, read its own identity); a separate execution role injects
  secrets at start. The agent cannot fetch raw secrets even though the task launched with them.
- **Inner confinement** — Anthropic's `sandbox-runtime` confines the filesystem to the
  working tree for harnesses without their own permission model (e.g. Pi).

### Run it locally

```bash
# Build the agent + egress-proxy images (self-contained; no devcontainer needed)
bash sandbox/image/build.sh

# Bring up the stack — agent on an internal network, all egress via the allowlist proxy
SANDBOX_PROFILE=claude-code docker compose -f sandbox/compose/docker-compose.yml up
```

### Run it on AWS Fargate

Same image, thin orchestration ([`sandbox/deploy/`](sandbox/deploy/)):

```bash
bash sandbox/deploy/bootstrap.sh                       # one-time: ECR, log groups, IAM roles
bash sandbox/deploy/run.sh --subnets subnet-… \
  --security-groups sg-… --profile claude-code --operator you
```

### Plugging in a harness

The substrate is harness-agnostic. A [profile](sandbox/profiles/) is one `.env` + a config
dir; the substrate stages it and execs `$HARNESS_CMD`. Profiles ship for Claude Code, Codex,
and Pi — adding another is one file, no substrate changes. The agent's *workflow* (what it
actually does) lives inside the harness and is intentionally out of scope here.

| What to read | Where |
|--------------|-------|
| Substrate overview + threat model | [sandbox/README.md](sandbox/README.md) |
| The harness contract | [sandbox/profiles/README.md](sandbox/profiles/README.md) |
| Egress allowlist (how to edit) | [sandbox/egress/README.md](sandbox/egress/README.md) |
| Fargate deployment | [sandbox/deploy/README.md](sandbox/deploy/README.md) |

---

## Claude Code overview

[Claude Code](https://code.claude.com) is Anthropic's agentic CLI coding tool. It reads your
codebase, edits files, runs commands, and integrates with your development tools directly from
the terminal.

### Installation

```bash
# macOS, Linux, WSL
curl -fsSL https://claude.ai/install.sh | bash

# Authenticate
claude auth login
```

### Key commands

| Command | Description |
|---------|-------------|
| `claude` | Start an interactive session |
| `claude "fix the login bug"` | Start with an initial prompt |
| `claude -p "query"` | One-shot print mode (non-interactive) |
| `claude -c` | Continue the most recent conversation |
| `claude update` | Update to the latest version |
| `claude auth login` | Sign in to your Anthropic account |
| `claude auth status` | Show authentication status |

### Slash commands

Once `scripts/setup.sh` has run, these are available in any Claude Code session:

| Command | Description |
|---------|-------------|
| `/pr-summary` | Generate a PR title and description |
| `/review` | Review current branch diff against project standards |
| `/test` | Generate tests for an Action, endpoint, or business flow |
| `/adr` | Scaffold an Architecture Decision Record |

### CLAUDE.md files

Claude reads `CLAUDE.md` files to understand project context. The hierarchy:

| Location | Scope |
|----------|-------|
| `~/.claude/CLAUDE.md` | Personal preferences, all projects |
| `./CLAUDE.md` or `./.claude/CLAUDE.md` | Repo-specific, shared with the team |
| `./CLAUDE.local.md` | Personal, repo-specific, not committed |

Context files can be imported using `@path/to/file` syntax. Each repo's `CLAUDE.md` uses this
to pull in additional context files that live alongside the codebase.

### Project rules

For larger projects, split instructions across `.claude/rules/*.md` files. Each file can be
scoped to specific paths using YAML frontmatter:

```markdown
---
paths:
  - "src/api/**/*.ts"
---

# API Rules
- All endpoints must include input validation
```

Rules without a `paths` field load at every session start, just like `CLAUDE.md`.

### Settings

Claude Code settings live in `~/.claude/settings.json` (user) and `.claude/settings.json`
(project). Key options:

```json
{
  "permissions": {
    "allow": ["Bash(npm run test *)", "Bash(git diff *)"],
    "deny": ["Read(./.env)", "Read(./secrets/**)"]
  }
}
```

See [Claude Code settings docs](https://code.claude.com/docs/en/settings) for the full reference.

---

## Agent Skills

Agent Skills are a complementary layer to the context documents and commands this repo provides.
They are reusable, domain-specific AI guidance for a specific workflow or area of a codebase.

### What they are

A Skill is a Markdown file stored in `.claude/` or `.github/skills/`. Skills are invoked with
`/skill-name` or loaded automatically when Claude determines they are relevant. Unlike the always-loaded context docs, skills load on demand — keeping context lean.

### Where they live

| Location | Who reads it |
|----------|-------------|
| `.claude/skills/` | Claude Code (native) |
| `.github/skills/` | Claude Code + Copilot |

### How they relate to this repo

| Layer | What it provides | Format |
|-------|-----------------|--------|
| **dotai** (this repo) | Shared platform context, engineering standards, slash commands | Wired in by setup script |
| **Skills** | Workflow and domain guidance for a specific repo | Markdown files, loaded on demand |

---

## Contributing

1. Branch from `main`
2. Make your changes to context docs or commands
3. Open a PR with a clear description of what changed and why
4. At least one reviewer required

