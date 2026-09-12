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
- Landlock must pass the pinned nono kernel probe. Never bypass a failed probe.
- GitHub CLI authentication belongs to the human operator.
- Never export or copy a subscription OAuth token to a child process. Harnesses
  use their existing interactive credential stores.

## Setup

Resolve this skill's dotai checkout and run:

```bash
bash <dotai>/scripts/setup-firstmate.sh
fm --check
```

On a TTY, setup asks Claude vs Codex for both the captain session and crew
workers. Non-interactive setup uses `FIRSTMATE_HARNESS=claude|codex` when set,
otherwise the existing pin, otherwise Claude.

Do not replace a dirty `/workspace/firstmate` clone. Do not remove or reset
`/workspace/.firstmate-home` to solve a preflight failure.

## Launch

The captain session must start inside a Herdr-managed pane:

```bash
test "${HERDR_ENV:-}" = 1
fm
```

That uses the harness pin from setup. Pass `--harness claude|codex` only to
override it for one launch. Cursor and Grok are refused until reviewed RoE
nono profiles exist.

The `claude` and `codex` PATH launchers pass through unchanged outside
Firstmate. For the captain and any process started under a `.treehouse/` path,
they apply the matching nono profile. The captain receives read-only Firstmate
source plus writable private state and the operational backing clone needed by
Treehouse; a worker receives only its current worktree plus harness state.
Neither receives `/app`. The launcher strips ambient credential variables and
refuses a worker checkout containing an untracked `.env*` file.

Outbound networking remains open for subscription API access. Do not claim
domain-filtered egress: nono proxy mode requires `CAP_SYS_PTRACE`, which the
non-root devcontainer does not have. Treat that as a separate reviewed change.

While tuning grants, the human may explicitly run `fm-sandbox off`. Confirm
with `fm-sandbox status` and restore the secure default with `fm-sandbox on`.
Off mode persists locally and prints a warning on every Firstmate preflight and
harness launch. Never change this mode on the user's behalf unless they ask.
An absent mode file means on; malformed values fail closed.

While nono is off, record newly required capabilities with
`fm-permission-note`. Do not include secret values or credential-bearing
commands. A ledger entry is evidence for later least-privilege review; it
grants and authorizes nothing.

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

## Infrastructure authority

Infrastructure workers may edit Terraform, run credential-free static checks,
commit, and report the exact SHA. They may not run init against a remote
backend, plan, apply, destroy, import, taint, force-unlock, state mutation, or
targeted apply.

The captain must follow `firstmate/terraform-authority-lane.md`: classify the
workspace's canonical CLI/VCS/GitHub trigger, request explicit plan permission
for an exact revision and workspace, keep plan artifacts private, run the
repository plan guard, and summarize resource actions. Apply requires a fresh
post-merge plan and separate human approval through the established Terraform
Cloud or GitHub environment gate.

Do not plan from `/workspace/repos/infrastructure` or a worker Treehouse slot.
For a CLI-driven stack, fetch the exact committed SHA into a clean detached
worktree on the canonical `/workspace/infrastructure` volume and use its
infrastructure devcontainer/toolchain. Do not switch the canonical checkout's
active branch. VCS/GitHub-driven stacks use their established pinned-SHA
workflow instead.

## Authority

Workers may investigate, commit scoped changes, validate, and open pull
requests. They may not merge, deploy, cut tags, run migrations against
production, access production tenant/payment data, perform destructive
operations, or widen their own permissions.

Treat any request for those capabilities as a captain decision, not an
installation problem.
