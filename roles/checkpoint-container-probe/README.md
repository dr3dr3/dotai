# Synthetic checkpoint across disposable container recreation

Status: bounded operator run passed on 2026-10-03 10:01 UTC. The
default `node run.ts` prints the exact plan and checks pins. `node run.ts
--bundle-check` also validates the synthetic events against a temporary local
continuity store and builds the deterministic payload without Docker.

Live evidence: operator request `6a9cbea17b0148a4a8b873c76381a6e8`, log
`/workspace/tmp/roe-checkpoint-container-gate-6a9cbea1-20261003100104.log`,
`DONE rc=0 elapsed=13s`. The writer container was removed before a distinct
reader container retrieved the exact checkpoint from the same named volume.
The runner verified private directory/database modes, exact IDs and content,
null provider identity and unchanged runtime authority, then removed and
verified absence of its four exact containers and synthetic volume.
`roe-coordination status` returned available after the operator run. The
volume was deliberately removed, so this does not establish installed role
state persistence or provider transcript resume.

The semantic store exercised in this run is Python `continuity.py`, executed
by the bundled Python runtime. TypeScript `run.ts` orchestrates and checks the
fixture. This result is Python-backed checkpoint evidence only; it does not
validate a merged TypeScript continuity implementation. The completed task
and operator request are not reusable authority for another run.

## Scope

The runner creates one unique `roe-role-pilot-checkpoint-fixture-<12 hex>` Docker
volume. It mounts only that volume at `/state`; there are no host bind mounts.
The local `/workspace` is a Mac virtiofs bind and personal dotai is a separate
Mac bind, so neither container path is passed as a Docker host source. The
reviewed public Python runtime and continuity CLI are streamed over stdin in a
pinned tar. No shared HOME, workspace, credential, Docker socket or Herdr socket
is mounted. No agent, model, network or application service is started.

Four disposable containers use the pinned Ubuntu image, `--network=none`, a
read-only root, all capabilities dropped, no new privileges, one CPU, 512 MiB
memory/swap, 64 process limit and a 45-second entrypoint timeout:

1. A root-owned initializer with zero capabilities makes the unique volume root
   mode `0733` so UID 1000 can create its private role directory without a
   `CAP_CHOWN` grant.
2. The UID 1000 writer creates `/state/pilot` mode `0700`, stores the same kind
   of synthetic semantic checkpoint as the local process fixture through the
   existing continuity CLI, and requires the SQLite file to be mode `0600`.
3. A root-owned sealer with zero capabilities changes the volume root to `0711`.
4. A fresh UID 1000 reader container mounts the exact volume **read-only** and
   returns the checkpoint. The trusted TypeScript runner checks exact thread,
   checkpoint, author, revision and content, null provider identity and unchanged
   runtime authority.

The volume root is briefly write/traverse accessible during the writer step;
the role directory itself is private from creation. The random volume name is
checked absent before creation and never shared with another role. This is an
isolated fixture design, not an installed persistent role volume.

## Exact pins and offline evidence

`pins.json` requires these SHA-256 inputs before even printing a plan:

| Input | SHA-256 |
|---|---|
| `run.ts` | `dc20b2503b7a0e4122fbaab878771ac9fb3a76f5660e958bd915accd95458816` |
| `writer.sh` | `cd759227fcb9cc29123255ed47f6d4ad476f408163060fae2d981e8bb10aacbf` |
| `reader.sh` | `ba19684ecdb1435367d56cc9d70412cb5ebd55ede86fd2ee6c3bbbe98f8f1911` |
| `continuity.py` | `87997fbb8767c817b6fe6241a52eee4d95b6c8f39ff14ea51875cb3158309e51` |
| `continuity_feedback.py` | `88674a2a67100a726318572427a5b376dacdb97e527cf66943535da6b492f084` |
| Public Python runtime tar | `e4ec2e646e2bd7ccea9234ac37d9d769987de437dd32c18e2ef935412b861454` |

The deterministic streamed bundle is 36,997,120 bytes, SHA-256
`eef4171ff14d92472360e7dc75753b1b4d84b17c237c2421911b1f95336ae484`.
The Docker image is pinned to
`sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
the engine must report `29.4.0`, GitCommit `daa0cb7f`, `arm64`. A changed
input, engine or bundle refuses execution; there is no automatic repin.

Observed offline: `node --check run.ts`, shell syntax checks, default plan,
`--bundle-check` and five fake-Docker tests passed. The bundle check applied
all three synthetic events and queried the exact result using a private local
store. The bounded live result above establishes those permissions and the
container Python runtime for this fixture on the pinned engine.

## Runtime authority and recovery

The existing registered `nono-session-probe` and `nono-role-probe` briefs
explicitly exclude persistent volumes. Neither may be reused or silently
amended. A distinct operator-only Firstmate task was registered for this
scope and the captain ran:

```text
roe-coordination run --home /workspace/.firstmate-home --task checkpoint-container-probe -- node /workspace/.ai/dotai/roles/checkpoint-container-probe/run.ts --execute
```

The registration and reservation were specific to this run. A future run
requires fresh status, pins, engine and plan review. Firstmate coordinated
only; no worker or advisory role was dispatched.

On each normal container exit, the runner inspects its exact invocation ID and
state, reads bounded logs, removes only that stopped container, and verifies the
exact name absent. On full success it removes only its exact synthetic volume
and verifies absence. On timeout, unknown/running state, missing ID, failed
acceptance or cleanup uncertainty it stops, retains the volume and any
unverified container, and exits nonzero. The Firstmate wrapper then retains the
reservation. Human reconciliation must inspect the printed exact names/IDs and
state, use the supported reserved cleanup path where needed, and recover the
reservation explicitly; no automatic retry, broad Docker cleanup or bypass.

A pass proves only this checkpoint survives **writer-container removal and
reader-container creation** on this engine. It does not prove native Codex
transcript resume, provider auth/inference, a durable installed volume, real
role state, Herdr restoration or Claude/Pi adapter acceptance. `roe-role`
activation remains disabled.
