# [REPO NAME] — CLAUDE.md

> **Instructions for repo maintainers:** Copy this file to the root of each repo as `CLAUDE.md`.
> Fill in the `[REPO NAME]`, `[REPO DESCRIPTION]`, and the repo-specific sections below.
> Optionally place it at `.claude/CLAUDE.md` instead. Remove this instruction block when done.

---

## Shared context

All engineering standards, architecture, testing philosophy, domain language, and platform context
are documented in the shared dotai context layer. Import them directly:

@~/.claude/context/architecture.md
@~/.claude/context/engineering-standards.md
@~/.claude/context/testing-philosophy.md
@~/.claude/context/platform-context.md
@~/.claude/context/domain-language.md

If those files are not available, the full context is in the `dotai` repo at `context/`.

---

## What this repo is

**[REPO NAME]** — [REPO DESCRIPTION: 1-2 sentences on what this service does and its role in the platform.]

Tech: [e.g., TypeScript / Node.js, Python / Django, PHP / Laravel — language, framework, key version]

---

## Repo-specific conventions

> Fill in anything that differs from or extends the shared standards.

### Module / folder structure

[List the top-level modules or domain areas in this repo, and any that have non-obvious structure. e.g.:]
- `[domain-A]/` — [what it owns]
- `[domain-B]/` — [what it owns]

### Key models / entities

[List the most important models or domain objects and where they live, e.g.:]
- `[path/to/Order]` — the central order entity
- `[path/to/User]` — the authenticated user/actor

### Critical flows to be careful with

[Highlight any flows that are particularly sensitive to regressions, e.g.:]
- e.g., Data isolation — always route writes through `[your scoping middleware or service]`
- e.g., Payment processing — test all code paths before touching `[payment module path]`

### Anything this repo does differently from the shared standards

[Note any intentional deviations from the shared context, e.g.:]
- e.g., This service uses [framework version X] pending upgrade to [version Y]
- e.g., State management uses [library A], not [library B] used elsewhere

---

## Available slash commands

Run these from Claude Code to get context-aware output:

- `/pr-summary` — Generate a PR description following project conventions
- `/review` — Review code against project-specific standards
- `/test` — Generate tests following project testing conventions
- `/adr` — Scaffold an Architecture Decision Record

---

## Behavioural guardrails

When working in this repo, always:

- [FILL IN: e.g., "Use `[YourDomainTerm]` (not [generic synonym]) for [concept]"]  
- [FILL IN: e.g., "Put business logic in [your layer], never in [restricted layer]"]  
- [FILL IN: e.g., "Check `[your ADR/decision log path]` before implementing in ADR-covered areas"]  
- [FILL IN: e.g., "Run `[your formatter command]` before committing"]  
- Mock all external service calls in tests — never make live API calls in the test suite

Never:
- [FILL IN: e.g., "Hard-code tenant or org IDs"]
- [FILL IN: e.g., "Bypass `[your data-isolation mechanism]`"]
- Commit `.env` files or secrets
- Leave debug statements (`console.log`, `dd()`, `debugger`, etc.) in committed code
