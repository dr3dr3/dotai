# [REPO NAME] — AGENT.md

> **Instructions for repo maintainers:** This is the equivalent of `CLAUDE.md` for AI tools that
> look for `AGENT.md` (Cursor, Windsurf, Codex, etc.). Keep it in sync with `CLAUDE.md`.
> Copy to the repo root as `AGENT.md`, fill in the sections, and remove this instruction block.

---

## Engineering context

@~/.claude/context/architecture.md
@~/.claude/context/engineering-standards.md
@~/.claude/context/domain-language.md
@~/.claude/context/testing-philosophy.md
@~/.claude/context/platform-context.md

---

## What this repo is

**[REPO NAME]** — [REPO DESCRIPTION]

Tech: [e.g., Laravel 12, PHP 8.3]

---

## Absolute rules

[List the non-negotiable rules for this codebase. Example:]

1. Business logic belongs in **Action classes**, never in Controllers
2. **Never hard-code tenant IDs** — always from request context
3. **Never commit `.env` files** — use `.env.example` as the template
4. **Use domain terminology** from `context/domain-language.md`
5. **Check ADRs** before implementing in any ADR-covered area (`docs/architecture-decision-records/`)

---

## Architecture

[Describe the high-level architecture relevant to this repo. Example:]

- Module structure: `Modules/<Name>/`
- Routes: `Modules/<Name>/Routes/api.php`
- Models: `Modules/<Name>/Entities/`
- Tests: `Modules/<Name>/Tests/`

---

## Repo-specific notes

[Fill in anything specific to this repo that extends or overrides the shared context.]

