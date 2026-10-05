# Firstmate registration request: role-state-doctor-repair

Lane: independent personal internal tooling. Register a **new** queued,
metadata-only, operator-only scout with `worker_dispatch=none`. Do not reuse
the failed `role-prepare-doctor-probe` reservation or task as authority. This
registration must not run Docker, recover a reservation, alter a volume,
launch a role or dispatch a worker.

## Why the first prepare run stopped

Captured request `6c416c1e9a6d40ccaf61452954dd8e53` returned exit code 1;
log `/workspace/tmp/role-state-prepare-gate-6c416c1e-20261004020449.log`
ends `=== DONE rc=1 elapsed=2s ===`. It created exact volume
`roe-role-pilot-state-v1`, wrote the private role directory, sealed the
volume root, and proved all four containers stopped and removed by exact
IDs. The UID 1000 doctor then ran `find /state` and got `Permission denied`:
the root had intentionally been sealed to `0711`, so listing it was the
incorrect check. The runner stopped and retained the volume and Firstmate
reservation `9a610dbb07069c92`.

Read-only reconciliation: the reservation runner PID `2086838` is absent,
the Firstmate staging directory has no entries, and the captured log proves
the four exact container removals. The private volume's full content is **not
yet accepted**. This is sufficient evidence to ask the captain to review an
explicit recovery that only releases the stale reservation, leaves the
volume intact, and permits a separate read-only doctor request. Do not
recover automatically or treat the failed prepare as a pass.

## Exact repair source

- Worktree `/workspace/.ai/dotai-role-prepare-repair`, branch
  `feat/role-prepare-doctor-repair`, committed HEAD
  `cd7566e2387b62629820eac3d4a574aa16a028b3`.
- Runner `roles/role-state-doctor-repair/run.ts` SHA-256
  `c0c7dcf67d2dd473d7623503daa6c75055c7194e260636c6cfd54a902a7f4629`.
- Pin manifest `roles/role-state-doctor-repair/pins.json` SHA-256
  `d4fa71e7505202877440a39f0b94b325986790f953c074333611d79ee4d51c10`.
  It pins the TypeScript launcher/state module, role catalogue, unchanged
  native Codex 0.157.1 pin, nono 0.76.0 and pidfd-only seccomp policy.
- Reviewed native Codex ELF SHA-256 remains
  `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`;
  no re-pin or Codex process launch.
- Image `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
  engine 29.4.0 / `daa0cb7f` / arm64.

The repair replaces the invalid root listing with an assertion that UID 1000
**cannot** list `/state`, while still checking its own role directory,
ownership, modes, contract digest and empty home. It does not change the
volume or role state. The new runner accepts only `--plan` or `--doctor`;
`--prepare` refuses. Offline: 11 TypeScript tests, targeted typecheck,
Prettier, Node/embedded shell syntax and a local sealed-directory behavior
check passed. Plan mode verified exact pins without Docker. Operational mode
refused without a reservation before Docker.

## Recovery prerequisite and exact doctor request

The captain must first review the retained ownership and evidence above and,
if satisfied, perform the explicit `roe-coordination recover` procedure for
reservation `9a610dbb07069c92` with the required
`--processes-stopped-and-state-reviewed` assertion. Recovery must preserve the
volume. This task's registration does **not** do that. If ownership or state
has changed, stop and reconcile the new facts instead.

After recovery, fresh `roe-coordination status`, source/pin verification and
operator review, run only this captured `local-runtime` command under the
**new** task:

```text
roe-coordination run --home /workspace/.firstmate-home --task role-state-doctor-repair -- bash /workspace/tmp/roe-role-doctor-repair.sh
```

The script SHA-256 is
`1ed4a293643af01c2929130953587fb3d4f39a2d0a626c7a6f765940a0844e8f`.
The runner checks the exact existing volume labels/local driver/no options,
mounts it read-only in one fresh UID 1000 container, and verifies the
sealed-root denial, private paths, ownership, modes, contract/profile digest
and absence of files/symlinks in role home. The container must exit 0 and be
removed by exact ID; the volume remains installed. No host bind, shared
HOME/workspace, socket, network, credential, model call, Python solution code
or role launch is involved.

On any refusal or nonzero result, retain the volume and reservation for
reconciliation; do not retry, force cleanup or broaden grants. A pass proves
only credential-free installed state inspection after this repair. Provider
auth/inference, Codex startup/native transcript resume, Herdr restore and
Claude/Pi adapter acceptance remain separate gates. Role activation stays
disabled.
