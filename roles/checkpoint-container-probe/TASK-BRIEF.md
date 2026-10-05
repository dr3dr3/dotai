# Proposed Firstmate registration: `checkpoint-container-probe`

Operator-only scout task. Firstmate coordinates one reservation; André runs the
exact reviewed command in his terminal. No worker, model call, credential,
application stack change or advisory role launch. The current registered probe
tasks forbid persistent volumes, so this is a **new task request**, not an
amendment or use of their existing task IDs.

Source and acceptance: [README.md](README.md), `run.ts`, `pins.json`,
`writer.sh`, `reader.sh`, `test_run.ts`. The runner is plan-only by default.
Reviewed source SHA-256 for `run.ts`:
`dc20b2503b7a0e4122fbaab878771ac9fb3a76f5660e958bd915accd95458816`.
Review all six pinned inputs and bundle SHA-256 in the README again before
registration. Image and engine are exact-pinned there. The only mount is a new,
uniquely named synthetic role-state Docker volume at `/state`; the reader mount
is read-only. No host path or socket is mounted.

Proposed captain command after registration:

```text
roe-coordination run --home /workspace/.firstmate-home --task checkpoint-container-probe -- node /workspace/.ai/dotai/roles/checkpoint-container-probe/run.ts --execute
```

Acceptance: one private `0700` role directory and `0600` SQLite file, exact
checkpoint content recovered in a new container with null provider identity,
both writer/reader container IDs distinct and exact containers absent, exact
volume removed, all command phases exit 0. A failure retains the volume and
reservation for human reconciliation; never rerun or widen access on failure.
No claim of native transcript persistence, provider use or Herdr restore.
