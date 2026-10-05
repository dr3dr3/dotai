# Firstmate registration request: role-prepare-doctor-probe

Lane: independent personal internal tooling. Register one queued,
metadata-only, operator-only scout task with `worker_dispatch=none`. It
coordinates two separate captain-operated reservations. Do not dispatch a
worker, launch a role, grant credentials, run Docker during registration or
reuse the earlier inert-launch task.

## Committed source and exact pins

- Worktree `/workspace/.ai/dotai-role-prepare-acceptance`, branch
  `feat/role-prepare-doctor-acceptance`, commit
  `406add9f92abe9a81d1e6d6e0a6655dd3c1feb00`. Its TypeScript launcher,
  private-state implementation, tests, runner and pin manifest are committed.
- Runner `roles/role-prepare-doctor-probe/run.ts` SHA-256
  `79da8eb3b2e17dd43c85d268cab97d9de641fc29781f923940cb5aaac234ad66`.
- Manifest `roles/role-prepare-doctor-probe/pins.json` SHA-256
  `6f3f077137f373750752ff4e60b89118db586819d60113afdcf10cb704d541de`.
  It pins the TypeScript launcher/state module, catalogue, Codex runtime pin,
  nono 0.76.0 binary and pidfd-only seccomp policy.
- Native Codex 0.157.1 ARM64 ELF SHA-256
  `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
  The trusted host verifies it but no container runs it. No re-pin.
- Image `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
  engine 29.4.0 / `daa0cb7f` / arm64. Generated nono profile SHA-256
  `f72771dc1fad3131882e5ec7714d597b8e31e3a9c937c59ef82e2ba7cbeb24eb`.

Offline evidence: 11 TypeScript tests passed; targeted typecheck, Prettier,
Node and embedded shell syntax passed. The runner's `--plan` checked source
pins and native Codex digest without Docker. Both operational modes refused
without a Firstmate reservation before any Docker call. The earlier inert
launch passed separately; it does not prove this committed source or install.

## Exact requests, in order

After registration and fresh `roe-coordination status`, prepare with one
captured `local-runtime` Operator request:

```text
roe-coordination run --home /workspace/.firstmate-home --task role-prepare-doctor-probe -- bash /workspace/tmp/roe-role-prepare-operator.sh
```

The script SHA-256 is
`23132c0d304c24a816f567f7e58311fc9bacba185309d7d769908f770f042945`.
Inspect its complete request record and log before another operation. Only if
it passes, use a **new reservation and captured request** for doctor:

```text
roe-coordination run --home /workspace/.firstmate-home --task role-prepare-doctor-probe -- bash /workspace/tmp/roe-role-doctor-operator.sh
```

The doctor script SHA-256 is
`d260ca76dfeb030c110b731d2bdc873d2d1ccb3cb8ef96e2a5dce851fc1bd809`.
Do not submit or run doctor until prepare evidence is reviewed. A reservation
coordinates shared runtime access; registration is not execution authority.

## Scope and acceptance

`prepare` refuses a changed source, policy, binary, engine or foreign volume.
It creates only the local `roe-role-pilot-state-v1` volume with the exact
`pilot`/purpose/TypeScript-continuity labels and no driver options. A root
maintenance container temporarily sets volume-root mode `0733`; a UID 1000
maintenance container creates `/state/pilot` and selected subdirectories at
`0700`, a `0400` contract and inert instruction file; a root container seals
the volume root to `0711`. A read-only doctor container then checks exact
metadata, ownership, modes, contract/profile digest and empty role home.
Four stopped containers must be removed by exact IDs. The private volume
remains installed intentionally. Re-running prepare on a matching existing
volume performs doctor only and never overwrites role state.

The later `doctor` request mounts that exact volume read-only in one fresh
UID 1000 container, rechecks the same invariants, and removes the stopped
container by exact ID. It does not create or modify the volume.

All containers use the pinned image, one named volume mount, no host bind or
shared HOME/workspace, no Docker/Herdr socket, `--network=none`, read-only
image root, all capabilities dropped, no new privileges, the reviewed seccomp
policy, CPU/memory/pid caps and a 60-second process timeout. No credential,
model call, Codex process, Python code or role activation is included.

## Failure and recovery

Any nonzero result, uncertain container state, missing CID, changed pin,
partial volume or cleanup doubt stops. The exact volume and Firstmate
reservation remain for human reconciliation; do not force-remove the volume,
retry, broaden grants or bypass a refusal. In particular, failure before the
seal step can leave the volume root temporarily at `0733`; inspect the
captured IDs, volume metadata and `roe-coordination status` through the
registered owner and use Firstmate's explicit recovery path.

Passing both requests would prove only the installed private-state mapping
and read-only inspection across separate reservations. It would not prove
Codex startup, provider auth/inference, native transcript resume, Herdr
restore or Claude/Pi adapter acceptance. `roe-role run` remains disabled.
