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
├── setup.sh                       ← Install AI tools (Claude Code CLI, GitHub CLI)
└── README.md                      ← This file
```

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

## How it works

Two setup scripts with distinct responsibilities:

### `setup.sh` (repo root) — installs AI tools

- **Claude Code CLI** via the official Anthropic installer (`curl -fsSL https://claude.ai/install.sh | bash`)
- **GitHub CLI** (`gh`) for PR workflows

### `scripts/setup.sh` — wires commands

1. **Copies** `commands/*.md` into `~/.claude/commands/` so they appear as `/command-name` slash commands in Claude Code
2. **Writes** a `CLAUDE.md` in the current repo if one does not exist yet (uses the template as a base)
3. **Writes** `.cursorrules` / `.windsurfrules` for Cursor/Windsurf if those tools are detected

Each repo's own `CLAUDE.md` contains context relevant to that codebase. Context lives in the repo
that owns it — not in a shared layer.

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

