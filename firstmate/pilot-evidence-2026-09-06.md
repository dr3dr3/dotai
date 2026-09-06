# Local Pilot Evidence — 2026-09-06

## Environment

- Firstmate: `51d2e8c902bb8785093969f8ba738c7355a283e0`
- Treehouse: `2.3.0`
- Herdr client/server: `0.8.2`, protocol `20`
- Pilot project: `rock-of-eye-api`
- Backing clone: API Docker volume, separate from `/app`

## Passed

- Clean upstream Firstmate clone remained unmodified at the reviewed pin.
- `FM_HOME` was created separately at `/workspace/.firstmate-home`.
- Firstmate's universal bootstrap toolchain passed after installing its current
  axi dependencies.
- Herdr created a named pilot session and a Firstmate worker endpoint.
- Treehouse allocated a worktree beneath the backing clone's in-project pool,
  not the backing primary and not the shared `/app` checkout.
- The wrapper's automated tests rejected:
  - two occupied/unavailable slots;
  - a pool entry with primary-checkout filesystem identity;
  - an off-pool worktree;
  - a shared `vendor` symlink.
- Closing the worker pane left task metadata and an untracked worktree marker
  intact.
- Normal teardown refused the dirty worktree and named the preservation
  reason.
- After deliberate removal of the test marker, teardown returned the slot and
  removed the task record.
- `stage-worktree` staged a committed branch SHA into `/app`.
- A second branch was refused while the first staging lock was held.
- `make exec-api ARGS="php artisan --version"` succeeded against the staged
  checkout.
- `make unstage` restored the prior checkout and released the lock.
- The named pilot Herdr session and test-only validation branches/worktrees
  were removed after verification.

## Blocked acceptance cases

Claude Code and Codex are installed but not authenticated in this
devcontainer. Cursor Agent CLI and Grok CLI are not installed. Therefore:

- no subscription-funded worker could complete a normal task;
- two sequential workers using different real harnesses could not be proven;
- branch creation and PR delivery by a real crew worker remain unproven.

The unauthenticated Claude worker was still useful as a blocker test. It
reached the subscription/API login selector in the Herdr pane, and the pane was
recoverable. Herdr reported that selector as `idle`, while Firstmate reported
the task as `working`; neither classified it as blocked. The earlier first-run
theme selector had the same problem. This is a material supervision gap for a
fresh or signed-out harness.

Cleanup also warned that `lsof` was unavailable, so Firstmate could not use its
process-group fallback during teardown. Cleanup still completed after the
exact Herdr endpoint had already been removed, but `lsof` should be installed
before another live pilot.

## Rollout decision input

Keep concurrency at one real worker. Do not authorize routine crew work until:

1. the chosen local harness is authenticated interactively by the human;
2. `lsof` is installed;
3. one normal Claude task completes from branch creation through preserved
   commit and serialized `/app` validation;
4. one different authenticated harness repeats the sequential path;
5. the login/theme prompt classification gap is either fixed upstream or
   documented as a mandatory first-run preflight outside crew dispatch.
