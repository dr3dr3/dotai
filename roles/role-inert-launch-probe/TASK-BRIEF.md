# Firstmate registration request: role-inert-launch-probe

Lane: independent personal internal tooling. Register one metadata-only,
operator-only scout task with `worker_dispatch=none`. This task coordinates
one bounded captain-operated runtime acceptance request. Do not dispatch a
worker, launch an advisory role, grant credentials, broaden a sandbox or reuse
the completed checkpoint or role-state fixture tasks.

## Exact source and offline evidence

- Dotai worktree: `/workspace/.ai/dotai-checkpoint-ts-acceptance`, HEAD
  `b3d9cf811b9770e9fde03a50b9ec1a888a6c4142` (merged TypeScript
  continuity). Candidate launcher/probe files are uncommitted, hash-pinned
  inputs in this isolated worktree; the older dirty checkout is untouched.
- Runner `roles/role-inert-launch-probe/run.ts`: SHA-256
  `19771973ff7ccc3fe0790b6e9e29ddddb93475e1f040dba7722babf54472edd8`.
- Pin manifest `roles/role-inert-launch-probe/pins.json`: SHA-256
  `6accf76c0f443cc8cf38156a1900120d0ae255f4a5d18a618225c5ed6fefca0c`.
  It covers the TypeScript launcher, imported exact-container helper,
  catalogue, Codex pin file, shell fixtures, nono binary and seccomp policy.
- Generated nono profile SHA-256:
  `f72771dc1fad3131882e5ec7714d597b8e31e3a9c937c59ef82e2ba7cbeb24eb`.
  Nono 0.76.0 validated it offline.
- Deterministic payload: 25,937,920 bytes, SHA-256
  `92664cf0f319308d4b5a1d6dc292827ec95b1b234f667ae3060b1353aea7be3f`.
- Reviewed native Codex 0.157.1 ELF SHA-256:
  `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
  It is checked on the host but never invoked in this fixture.
- Image `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
  engine 29.4.0 / `daa0cb7f` / arm64. Nono SHA-256
  `520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9`;
  pidfd-only seccomp policy SHA-256
  `189935cc4abea601443cca1d6dde03f9de2e5c01f789778edbd78445d1e466a6`.

Offline: TypeScript role-source six tests and probe-runner five injected-Docker
tests passed. Typecheck, Prettier, Node/shell syntax, nono profile validation
and deterministic bundle check passed. No Docker call ran for this fixture.

## Proposed operator command after registration and fresh status

```text
roe-coordination run --home /workspace/.firstmate-home --task role-inert-launch-probe -- node /workspace/.ai/dotai-checkpoint-ts-acceptance/roles/role-inert-launch-probe/run.ts --execute
```

Use a frozen script in the persistent Operator pane for a captured result.
Prepared script: `/workspace/tmp/role-inert-launch-probe.sh`, SHA-256
`dacfc36ab786b7a449264f5444cd7035f78cb5a7375528ed214cdbff73d76523`.
It contains only `node .../run.ts --execute` with shell strict mode; the
Operator `local-runtime` recipe supplies the registered Firstmate reservation.
Registration is a coordination prerequisite, not execution approval. Do not
run Docker directly or bypass a refusal.

## Scope, acceptance and recovery

The sole candidate state volume is `roe-role-pilot-state-v1`. The runner
refuses an existing volume, creates it with the exact TypeScript plan labels
and local driver/no options, and removes it on complete pass. Two disposable
containers, init and inert, mount only this volume; the inert container uses
one 128 MiB tmpfs. No host bind, shared HOME/workspace, Docker/Herdr socket,
credential, network or model call. The role process is an inert shell under
the generated nono profile, not Codex. The native Codex pin is verified only
on the trusted host.

Pass requires intended synthetic reads and selected role state writes;
denied protected/sibling reads, HOME/context writes and exec-child escape;
filtered synthetic token; all five zero capability sets, `NoNewPrivs=1`,
`Seccomp=2`; two distinct stopped container IDs removed exactly; and exact
volume removal/absence. Changed source, pin, policy, image or engine refuses.

Failure/timeout/unknown or running container/missing CID/cleanup uncertainty
stops. The exact volume and reservation remain for human reconciliation;
inspect printed IDs/names through `roe-coordination status` and the explicit
Firstmate recovery path before any retry. No force cleanup or grant expansion.

Passing would not prove installed persistent role state, provider auth or
inference, native Codex transcript resume, Herdr restore or Claude/Pi adapter
acceptance. `roe-role` activation remains disabled.
