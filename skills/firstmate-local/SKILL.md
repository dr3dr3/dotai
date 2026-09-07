---
name: firstmate-local
description: Set up, preflight, or launch the bounded Rock of Eye local Firstmate crew through Herdr, or explain how its Treehouse editing slots and stage-worktree validation fit together. Use when the user explicitly asks to operate the local Firstmate pilot or local crew.
---

# Local Firstmate Pilot

This skill operates the personal, bounded Firstmate pilot. Shared crew policy
comes from `rock-of-eye/ai-devex`; this skill owns only local installation,
preflight, and launch.

## Preconditions

- Run inside the local-dev-env devcontainer.
- Herdr is installed by personal dotfiles.
- GitHub CLI authentication belongs to the human operator.
- Never export or copy a subscription OAuth token to a child process. Harnesses
  use their existing interactive credential stores.

## Setup

Resolve this skill's dotai checkout and run:

```bash
bash <dotai>/scripts/setup-firstmate.sh
fm --check
```

Do not replace a dirty `/workspace/firstmate` clone. Do not remove or reset
`/workspace/.firstmate-home` to solve a preflight failure.

## Launch

The captain session must start inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
fm --harness claude
```

Use `codex`, `cursor`, or `grok` only when requested and when the corresponding
CLI is installed. The launcher fails closed when a requested harness is absent.

## Worktree responsibilities

Treehouse allocates isolated crew editing slots. It does not choose what the
Docker services run.

The tracked `treehouse` wrapper:

- forces the pool under the project repository;
- limits concurrent unavailable slots;
- refuses pool exhaustion;
- rejects a slot that is the primary checkout by filesystem identity;
- rejects slots outside `.treehouse/`;
- rejects shared `vendor` or `node_modules` symlinks.

Never bypass that wrapper or call its private real binary directly.

## Validate committed work

After a worker has committed:

1. Read the task metadata and confirm the exact project and branch.
2. Use the existing `stage-worktree` skill to stage that branch.
3. Run application commands through the matching `make exec-*` target.
4. Always unstage after validation.

Do not run Composer or Yarn dependency mutation in a Treehouse worktree.
Do not stage over another task's lock. Escalate the scheduling conflict to the
captain.

## Authority

Workers may investigate, commit scoped changes, validate, and open pull
requests. They may not merge, deploy, cut tags, run migrations against
production, access production tenant/payment data, perform destructive
operations, or widen their own permissions.

Treat any request for those capabilities as a captain decision, not an
installation problem.
