# Firstmate registration request: checkpoint-ts-container-probe

Lane: independent personal internal tooling. Register one metadata-only,
captain-operated runtime validation task with `worker_dispatch=none`.
Firstmate coordinates the reservation; it does not dispatch a worker, launch a
role, change an installed profile or grant credentials. The previous Python
checkpoint task `checkpoint-container-probe` does not authorize this run.

## Exact source and offline evidence

- Dotai source commit: `b3d9cf811b9770e9fde03a50b9ec1a888a6c4142`
  (merged TypeScript C1/C2 on `origin/main`). The implementation is read from
  the isolated worktree at `/workspace/.ai/dotai-checkpoint-ts-acceptance`;
  the older dirty checkout is untouched.
- Runner: `roles/checkpoint-ts-container-probe/run.ts`, SHA-256
  `6decfd8e2542bce03ef118963ed418f4f63d6df08c6bc9aff9428fbbb62a07b2`.
- Input pins: `roles/checkpoint-ts-container-probe/pins.json`, SHA-256
  `5e307113b2ef1a3c6e1a694ddf86ac6b99a01802cc2cddf5b8ea9ae7124bb1e1`.
  It covers the exact merged TypeScript modules, CLI, Node binary, arm64
  loader/libraries, package metadata, runner and shell fixtures.
- Payload: 127,703,040 bytes, SHA-256
  `41cd568fe9d255cf5f2dd3eb899fba38bf169ddcb05c9eb0bf08e8d9ac2afb51`.
- Node: 22.23.2, binary SHA-256
  `1a638b0fe2b68da0489276aca95526c5122fc61ba54d6a2d0d00c1c92ab7b876`.
- Image: `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`.
  Engine: 29.4.0 / `daa0cb7f` / arm64.

Offline checks passed: merged TypeScript suite 60 tests, `npm run typecheck`,
`npm run format:check`; new cross-process checkpoint test, five separate Node
CLI invocations with null provider identity and exact reload; runner five
fake-Docker tests; TypeScript and shell syntax; default plan and payload
bundle check. The bundle check executed the pinned Node binary against the
merged TypeScript store locally. No Docker call has run for this gate.

## Proposed operator command after registration and fresh status

```text
roe-coordination run --home /workspace/.firstmate-home --task checkpoint-ts-container-probe -- node /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/checkpoint-ts-container-probe/run.ts --execute
```

The runner itself also requires the injected reservation token and pins the
source commit, input hashes, payload, image and engine before creating state.
Register only after Firstmate reviews this exact scope. Use the persistent
operator pane for a captured run; no direct Docker command or reuse of the
completed Python checkpoint task.

## Runtime scope, pass and refusal

One UUID-suffixed Docker volume named `roe-role-pilot-checkpoint-ts-fixture-*`
is created after absence check. Four exact-named containers use only that
volume; no bind mount, shared HOME/workspace, socket, credential, network or
model call. The fresh reader uses a read-only mount. Each container uses the
pinned image, read-only root, no network, all capabilities dropped, no new
privileges, CPU/memory/PID limits and a 75-second entrypoint timeout. Writer
and reader use a 256 MiB disposable `/tmp` tmpfs for the 127 MiB payload.

Pass requires private role directory `0700`, SQLite file `0600`, the exact
synthetic checkpoint content/IDs/revisions, null provider identity, unchanged
runtime authority, four distinct stopped container IDs, their exact removal
and name absence, and removal/absence of the exact synthetic volume. Failure
or timeout stops; no grant expansion or retry. Unknown/running container state,
missing CID, failed reader or cleanup uncertainty retains the exact volume
and reservation. Reconcile from printed IDs/names using `roe-coordination
status` and the explicit human recovery path.

Passing does not prove native Codex transcript resume, provider auth/inference,
installed per-role state, Herdr restore or Claude/Pi adapter acceptance.
`roe-role` activation remains disabled.
