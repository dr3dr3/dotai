# Firstmate registration: codex-installed-startup-probe

Lane: independent personal internal tooling. Register a **new** queued,
metadata-only, operator-only scout with `worker_dispatch=none`. Registration
must not reserve the runtime, run Docker, create a volume, launch Codex or
dispatch any advisory role.

Source: `/workspace/.ai/dotai-codex-installed-startup`, branch
`feat/codex-installed-startup`. Verify committed HEAD and the exact SHA-256
of `roles/codex-installed-startup-probe/run.ts` and `pins.json` before writing
metadata. The runner pins all source/policy inputs and rechecks the reviewed
Codex 0.157.1 ARM64 ELF SHA-256
`9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`;
there is no re-pin. Image SHA-256 is
`786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
engine `29.4.0` / `daa0cb7f` / arm64.

The installed private volume `roe-role-pilot-state-v1` passed a separate
read-only doctor under request `17619164d40a4764924d4ecb370376a4`:
`STATE_DOCTOR_OK`, exact doctor container removal, `DONE rc=0`. This new
fixture checks Codex app-server initialization against a **disposable clone**
of that installed state. It mounts the installed volume read-only only during
the copy phase; the native binary runs against the clone, never the installed
volume. The role home must be empty before copying. The clone is removed on
success and retained for review on any refusal. No credentials, model calls,
provider network, host bind, shared HOME/workspace, Docker/Herdr socket or
role activation are authorised.

After registration, fresh `roe-coordination status`, source/pin verification,
and captain review, the separate Operator request may run only:

```text
roe-coordination run --home /workspace/.firstmate-home --task codex-installed-startup-probe -- node /workspace/.ai/dotai-codex-installed-startup/roles/codex-installed-startup-probe/run.ts --execute
```

Acceptance requires: exact installed-volume label/driver checks; empty role
home before copying; exact clone permissions and contract digest; native
Codex `initialize` response and clean EOF exit under nono; protected and
sibling denials; zero capability sets, no-new-privileges and seccomp; exact
container/clone removal; installed volume preserved; complete captured
`DONE rc=0`. On any failure retain the clone and reservation and reconcile
before another attempt. A pass proves only startup against a clone of the
installed layout. It does **not** prove native transcript persistence or
resume, provider auth/inference, a live role, Herdr restore or Claude/Pi
acceptance. `roe-role run` remains disabled.
