# Harness-independent checkpoint process fixture

Run `node checkpoint-probe.ts` from this directory. It needs Node 22 and the
existing Python standard-library continuity CLI. It does not require a Firstmate
reservation because it never touches the shared runtime.

The fixture creates one private temporary store, then starts two separate Node
processes. The writer invokes the existing continuity CLI to register a synthetic
session with `identity: null`, open a synthetic thread, and commit a semantic
checkpoint. The reader starts only after the writer exits. It queries the same
store and requires the exact thread/checkpoint IDs, author, assignment revision,
content, absent provider identity, and `runtime_authority: unchanged`. The
fixture checks directory and database permissions and removes only its own
temporary directory on completion.

The child processes receive a minimal environment. No credentials, auth file,
model call, network operation, role launch, Docker command, real checkpoint,
Herdr state or provider transcript is involved. `roe-role` remains disabled.
This proves a local checkpoint can be written and reloaded across processes
using the current continuity store. It does not prove persistence across
container recreation, native Codex transcript resume, provider auth/inference,
or safe Herdr restore.

Offline result, 2026-10-03: `node checkpoint-probe.ts` returned 0 with
`PASS: credential-free checkpoint persisted across processes`; `node --check`
returned 0. Claude and Pi still refuse launch as unverified adapters.
