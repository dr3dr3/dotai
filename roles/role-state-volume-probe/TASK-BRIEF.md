# Firstmate registration request: role-state-volume-probe

Lane: independent personal internal tooling. Register one metadata-only,
operator-only scout task with `worker_dispatch=none`. This new task coordinates
two separate captain-operated reservations; it dispatches no worker and grants
no credential, sandbox expansion, role activation or production authority.
The completed `checkpoint-ts-container-probe` task does not authorize these
new stateful operations.

## Reviewed source and offline evidence

- Isolated dotai source commit:
  `b3d9cf811b9770e9fde03a50b9ec1a888a6c4142` (merged TypeScript
  continuity). The probe files are uncommitted in that isolated worktree and
  are bound by the hashes below. The older dirty checkout remains untouched.
- Runner: `/workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/run.ts`,
  SHA-256 `04be56c93d2d758a4ac1320c340be967d19fe88cb09a060eafff42d764cc1d61`.
- Runner pins:
  `/workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/pins.json`,
  SHA-256 `a008afa3c7b4cfb2566e881eb0a7338f27e7751ad99323f0e4047c40711b04d4`.
  The imported checkpoint runner verifies its own exact pins for the merged
  TypeScript modules/CLI, shell fixtures, Node binary and arm64 libraries.
- Bundled payload: 127,703,040 bytes, SHA-256
  `41cd568fe9d255cf5f2dd3eb899fba38bf169ddcb05c9eb0bf08e8d9ac2afb51`.
- Node 22.23.2 binary: SHA-256
  `1a638b0fe2b68da0489276aca95526c5122fc61ba54d6a2d0d00c1c92ab7b876`.
- Image: `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`.
  Engine: 29.4.0 / `daa0cb7f` / arm64.
- Offline: five injected-Docker tests passed, including exact mount scope,
  foreign volume refusal, separate install/verify, missing reservation refusal
  and failed-writer retention. Typecheck, formatting, Node syntax and offline
  payload bundle check passed. No Docker call has run for this fixture.

## Proposed runtime operations after registration and a fresh status

Two separate captured requests, run in order:

```text
roe-coordination run --home /workspace/.firstmate-home --task role-state-volume-probe -- node /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/run.ts --install
roe-coordination run --home /workspace/.firstmate-home --task role-state-volume-probe -- node /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-state-volume-probe/run.ts --verify
```

Use the persistent Operator pane with a frozen script for each request.
Do not chain these commands in one reservation. Inspect the complete first
request record/log and `roe-coordination status` before preparing the second.
No direct Docker command or reuse of another Firstmate task.

## Scope, acceptance and recovery

The sole candidate state location is the exact, test-only local Docker volume
`roe-role-pilot-state-fixture-v1`, mounted at `/state`. Exact labels declare
purpose `role-state-acceptance-fixture`, role `pilot`, and contract
`typescript-checkpoint-v1`; driver options are forbidden. No host HOME or
workspace source is inferred from devcontainer paths. No Docker/Herdr socket,
credential or model call reaches a role. The role never launches.

Install pass: volume was absent, then created with exact labels; init, writer
and seal containers each exit cleanly and are removed by exact ID; writer logs
the private `0700` role directory and `0600` SQLite file with the exact
synthetic checkpoint. The volume remains intentionally.

Verify pass: the exact volume metadata still matches; a fresh reader uses a
read-only mount and returns exact thread/checkpoint/session IDs, content,
revision 1, assignment revision 0, null provider identity and unchanged
runtime authority; its stopped container is removed by exact ID; the exact
volume is removed and its name is absent. This is separate-process/reservation
fixture evidence only, not installed role state or Herdr restoration.

Failure or timeout stops. Missing CID, unknown or running container, foreign
volume, failed reader or cleanup uncertainty retains the exact volume and
reservation. Reconcile the printed names/IDs through `roe-coordination status`
and explicit human recovery before any retry. `roe-role` activation remains
disabled; Claude and Pi remain unverified and refuse launch.
