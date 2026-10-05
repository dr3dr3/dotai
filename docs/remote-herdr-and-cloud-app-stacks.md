# Remote Herdr panes and cloud app stacks

Status: design for André, 2026-10-04. No desktop connection or cloud stack has been created or tested by this document.

## The boundary

Herdr, coding agents, credentials and human interaction stay in the MacBook or Omarchy devcontainer where each session started. A cloud stack supplies only isolated application services, data fixtures and test endpoints. A local Firstmate may request a cloud stack for a bounded task; it does not move an agent or a Herdr pane to that stack.

```text
MacBook: Herdr + agents + Firstmate ──┐
                                     ├── authenticated stack allocator ── cloud app/test stack A
Omarchy: Herdr + agents + Firstmate ──┘                         └──────── cloud app/test stack B

MacBook terminal ── Tailscale/SSH ── Omarchy host ── existing devcontainer ── chosen Herdr pane
```

These are two independent capabilities. Remote pane control changes the human's point of attachment; cloud allocation changes which app stack a local task can use.

## A safe first remote-pane trial

1. Put the MacBook and Omarchy **hosts** on the same tailnet and enable authenticated SSH access to Omarchy. No Tailscale or SSH daemon is needed inside the devcontainer for this trial.
2. On the Omarchy host, confirm the intended devcontainer is already running and identify its exact workspace folder. If stopped, report that and stop. Do not use `devherd` or `devsh` for this check: `devsh` deliberately starts a stopped devcontainer.
3. Run `devcontainer exec --workspace-folder <desktop-checkout> herdr session list --json` on Omarchy to discover running named sessions. Then, for the selected session, run `herdr --session <session> agent list` through the same existing container. Display names, IDs, session and machine together before choosing. Do not start a session or an agent during discovery.
4. From a MacBook terminal, use `ssh -tt <omarchy-tailnet-host> ...` to execute `devcontainer exec --workspace-folder <desktop-checkout> ... herdr --session <session> agent attach <target>` in that existing container. The host-side command must repeat the running-container guard immediately before attachment; failing the guard must exit without invoking `devcontainer up`.
5. Control a disposable chosen pane, detach using Herdr's detach key, and verify that the desktop pane and its process continue. Try a second attach. Do not use `--takeover` automatically; if a writable owner conflict occurs, show the owner/conflict and require a deliberate choice. Check local desktop layout because another client viewing the same tab can affect pane sizing.

This first path is an SSH terminal into the existing Herdr server, not a new Herdr server. A tiny host-side `remote-devherd` helper can package the guard, session listing and attach after the manual trial confirms PTY behavior. It should accept explicit host, workspace, session and target; avoid defaults that could select the pilot session or the wrong clone. Existing `devherd` and `devsh` should stay unchanged.

Native Herdr `--remote` and saved machines are a later usability option if a unified Herdr UI is worth adding an SSH endpoint inside the devcontainer. That endpoint brings new lifecycle and authentication work; it is unnecessary to prove selective remote control. The first trial should use ordinary SSH to the Omarchy host over Tailscale.

## Cloud stack allocation contract

The initial cloud candidate is a private VM running the existing Compose-based app stack, with its own mutable volumes, database, object store, ports and fixture data. An on-demand instance is simpler for the first proof; a small warm pool can follow if startup time warrants its cost. Reuse build, health and seed knowledge from the existing preview environment, but give development stacks their own identity and lifecycle. PR-preview cleanup must not reap them.

Each request carries a stable request ID, local Firstmate/task identity, exact source revisions, required components, fixture/data class, expected duration and resource ceiling. The allocator atomically returns either a single stack assignment or a refusal/queue result. Repeating the same request ID returns the same assignment; it must not create a second stack. A different task cannot claim an assigned stack merely because the requester has gone offline.

The assigned stack reports a private endpoint map and a short-lived access grant to the local requester. The task performs stage, test and restore under that stack's own reservation authority. The existing `roe-coordination` lock is local process state, so a separate central allocator is needed when MacBook and Omarchy can contend for the same cloud stack. A central assignment does not override the stack's reservation, and neither mechanism grants deployment, migration, production data access, agent launches or broader sandbox authority.

An allocation is reusable only after restoration verifies a clean baseline. Unknown health, lost contact, failed restore or leftover staging marks the stack quarantined. Expiry means stop new work and reconcile ownership; it must not silently release a possibly running task. The allocator stores assignment and health metadata, while the stack-local authority keeps command/reservation records. Keep raw credentials and task content out of the allocator record.

| Phase | Observable result | Boundary |
| --- | --- | --- |
| Request | One task/revision/component manifest and one idempotency key | Firstmate remains the local task coordinator |
| Assign | Atomic stack ID or refusal, with capacity and cost ceiling | No double allocation across MacBook and Omarchy |
| Prepare | Exact revisions and required dependencies are ready; health checks pass | No implicit production data or unrelated app services |
| Use | Local agent drives tests against private cloud endpoints | Agent and Herdr remain local; stack reservation covers stage/test/restore |
| Release | Restore verified, artifacts returned, assignment closed | Failed/uncertain state stays quarantined for explicit recovery |

The first proof should use one intentionally isolated cloud stack, one approved task, and a dependency-closed service subset. Measure provision time, test latency, restore time and idle cost before considering a pool. Existing local multi-instance support isolates Compose projects and ports, but shares some Tier 3 volumes; those shared mutable volumes must not be carried into cloud stack isolation.

## Ownership and next actions

Remote-pane helper: independent personal tooling in dotfiles, after a manual read-only discovery and disposable-pane trial on the real Omarchy host. The missing inputs are the Omarchy tailnet SSH target and the exact host checkout path. These are connection parameters, not a reason to choose a cloud architecture.

Cloud stack allocator and provider: app/platform infrastructure through a bounded Firstmate task brief. The first brief should specify one stack, exact components, data isolation, private connectivity, idempotent assignment, reservation and recovery semantics, and a measured acceptance trial. It should not authorize a cloud resource yet. The current local reservation mechanism remains in force for the shared local stack.

## Source notes

- Local entrypoints: `dotfiles/.dotfiles/bin/.local/bin/devherd`, `devsh`, and `dotfiles/docs/HERDR.md`.
- Local coordination: `ai-context/explanation/analysis/technical/2026-09-roe-coordination-baseline.md` and `roe-coordination status` (available; reservation required on 2026-10-04).
- Local multi-instance guide: `docs/guides/developer/multi-instance.md`.
- Product behavior: [Herdr concepts](https://herdr.dev/docs/concepts/), [remote and persistence](https://herdr.dev/docs/persistence-remote/), [connecting machines](https://herdr.dev/docs/connecting-machines/).
- Network and private access: [Tailscale device connections](https://tailscale.com/docs/how-to/connect-to-devices), [AWS Session Manager](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager.html).
