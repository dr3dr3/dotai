# Synthetic auth-file subpath preflight — TypeScript task request

Task identity: `ai-auth-file-subpath-preflight-20261005`.

Authoritative coordination home: `/workspace/.firstmate-home`.

This is one operator-only, inert runtime preflight in the personal independent
tooling lane. The 1 October request is historical evidence only: it must never be
rerun, restored, or used as an execution route. Registration of this replacement
does not approve a model turn, credential access, role activation, or any other
runtime operation.

## Reviewed inputs

All replacement-request sources are tracked together:

- `roles/nono-one-turn-probe/volume_preflight.ts`
- `roles/nono-one-turn-probe/test_volume_preflight.ts`
- `roles/nono-one-turn-probe/PREFLIGHT-TASK-TS.md`
- `roles/nono-one-turn-probe/run_volume_preflight.ts`

The tracked operator wrapper verifies the exact approved SHA-256 values of the
fixture, tests, and this brief, takes a private byte-for-byte snapshot of the
verified fixture, rechecks the snapshot, and invokes that snapshot only. It uses
the absolute coordination executable, inherits its output for the operator, and
passes a minimal environment with injection variables and any pre-existing
runtime token removed. It has no dependency on a temporary or untracked wrapper.
Registration must separately pin the final wrapper SHA-256 because a source
cannot safely embed its own digest.

Node compatibility is exactly stable Node `22.23.x`: major 22, minor 23, and a
numeric patch component, with no prerelease or build suffix. Every other Node
version must stop before coordination or Docker is invoked. The fixture enforces
the same rule and requires both a runtime reservation token and a wrapper-supplied
hash marker matching its running source. Direct fixture invocation is unsupported;
these checks are cooperative fail-closed guards, not proof that environment
variables are unforgeable authority.

The Docker engine pin is exactly version `29.4.0`, Git commit `daa0cb7f`, and
architecture `arm64`. The image pin is exactly
`sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`.
Both pins fail closed; they must not be refreshed or inferred during this task.

## Deployment gate and exact operation

Do not update the shared dirty checkout in place. Before registration, preserve
the untracked historical files as non-executable evidence outside this route,
then deploy a clean checkout at the merged replacement commit. Do not use
`git clean`, forced checkout, or deletion as a shortcut. Confirm that the
historical task registration is retired so it cannot select its former command.

Registration must pin the final wrapper digest and supply the literal reviewed
value where `<APPROVED_WRAPPER_SHA256>` appears below. The placeholder is
intentional: the brief is itself hash-pinned by the wrapper, so embedding the
wrapper digest here would create an unsafe circular digest dependency.

After separate registration and human review, the operator route is:

```text
WRAPPER=/workspace/.ai/dotai/roles/nono-one-turn-probe/run_volume_preflight.ts
printf '%s  %s\n' '<APPROVED_WRAPPER_SHA256>' "$WRAPPER" | sha256sum --check --status &&
  env -u NODE_OPTIONS -u NODE_PATH node "$WRAPPER" --execute
```

The wrapper enters the registered task through the authoritative coordination
home and invokes only the tracked synthetic fixture.

The fixture creates one UUID-suffixed synthetic Docker volume. A writer container
using the pinned image creates a marker `auth.json` and one unrelated sibling.
The writer retains `--cap-drop=ALL` and receives only `CHOWN`, which is required
to transfer ownership of the synthetic marker to uid 1000. It sets mode `0400`
before transferring ownership, so no `FOWNER` capability is needed, and uses
`volume-nocopy`. A non-root reader retains `--cap-drop=ALL` with no added
capability. Both containers use
`--network=none`, read-only root filesystems, no-new-privileges, and bounded
memory, CPU, process count, and time.

The reader asks Docker to mount only `auth.json` with
`volume-subpath=auth.json`, read-only. Acceptance requires the exact file to be
readable with the synthetic marker, a write-affecting chmod attempt to fail, mode
`0400` to remain unchanged, the sibling path to be absent, and exactly one
read-only mount at the requested file path whose mountinfo root identifies the
`auth.json` source subpath rather than the volume root. Cleanup always attempts
forced removal of the two exact synthetic container names followed by the exact
volume, including after a volume-create timeout. Separate inspect calls must
confirm all three objects are absent. A cleanup or absence-verification failure
retains the reservation for human reconciliation. There is no directory or
whole-volume fallback and no automatic retry.

This task names and uses no real credential volume or credential path. It does
not read credentials, open network egress, start an AI client, contact a provider,
launch a role, send a model turn, access a live Concierge store, or register
anything by itself. It proves only the pinned engine's handling of one synthetic
read-only file subpath.

## Current execution boundary

This branch preparation is offline only. Do not query or run Docker, register the
task, submit an operator request, activate a role, or access credentials while
reviewing and validating these sources.
