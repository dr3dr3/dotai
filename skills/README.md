# Agent Skills

A collection of agent skills that extend capabilities across planning, development, and tooling.

## Planning & Design

These skills help you think through problems before writing code.

- **write-a-prd** — Create a PRD through an interactive interview, codebase exploration, and module design. Filed as a GitHub issue.
- **prd-to-issues** — Break a PRD into independently-grabbable GitHub issues using vertical slices.
- **grill-me** — Get relentlessly interviewed about a plan or design until every branch of the decision tree is resolved.

## Development

These skills help you write, refactor, and fix code.

- **tdd** — Test-driven development with a red-green-refactor loop. Builds features or fixes bugs one vertical slice at a time.
- **triage-issue** — Investigate a bug by exploring the codebase, identify the root cause, and file a GitHub issue with a TDD-based fix plan.
- **improve-codebase-architecture** — Explore a codebase for architectural improvement opportunities, focusing on deepening shallow modules and improving testability.

## Tooling & Setup

- **setup-pre-commit** — Set up Husky pre-commit hooks with lint-staged, Prettier, type checking, and tests.
- **git-guardrails-claude-code** — Set up Claude Code hooks to block dangerous git commands (push, reset --hard, clean, etc.) before they execute.

## Session Awareness

- **debrief** — Mid-session zoom-out: a plain-English executive summary of the current session's goals (and drift), verified progress, blockers, decisions/dead ends, and a recommended next move. Grounded in `git`/`gh` at debrief time, hard-capped at ~50 lines.
- **wip-tracker** — Track work-in-progress across multiple concurrent AI coding sessions. Per-session index of PRs with live status; handoff notes ("park it") and fresh-session pickup.

## Communication

- **agent-email** — Send and receive email *as the agent* via AgentMail (`agent@rockofeye.net`). Human-in-the-loop only: draft → review → `--confirm` send, hard recipient allowlist, secret redaction, audit trail. Personal to André.

## Writing Skills

- **research-a-post** — Research a blog post idea against the work environment and produce a brain-dump: verified evidence (git, PRs, Linear, Sentry, CI, pinned versions) with a re-runnable source on every fact, artefacts captured verbatim, and an interview for the half only a human has. Output is one file to carry into the blog repo. Personal to André.
- **write-a-skill** — Create new skills with proper structure, progressive disclosure, and bundled resources.
