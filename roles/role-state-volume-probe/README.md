# Candidate per-role state volume across separate operator runs

This is a credential-free **acceptance fixture**, not an installed role state
volume or a role launcher. It uses the merged TypeScript continuity CLI. No
Python interpreter or code is bundled or invoked.

The stable, test-only Docker volume is `roe-role-pilot-state-fixture-v1`. It is
bound to the `pilot` fixture by three exact labels, the local driver with no
driver options, and one mount at `/state`. The writer runs as UID/GID 1000,
creates `/state/pilot` at `0700` and a SQLite database at `0600`. The reader
uses a read-only mount in a new disposable container. The fixture streams its
reviewed payload through stdin; there is no host bind, shared HOME/workspace,
Docker/Herdr socket, credential, network or model call. Every container uses
the pinned image, read-only root, dropped capabilities, no-new-privileges and
CPU/memory/PID/time limits.

`node run.ts` only prints the exact plan. `node run.ts --offline` additionally
checks all pins and exercises the bundled Node 22.23.2 binary and TypeScript
CLI locally. Neither mode calls Docker. Live modes require a Firstmate
reservation token and the registered operator task:

1. `node run.ts --install` refuses an existing volume, creates the labeled
   fixture volume, initializes and writes the exact checkpoint, seals the
   directory, removes each stopped container by exact ID, and **retains the
   synthetic volume** for a later operator run.
2. `node run.ts --verify` inspects the exact volume/labels/driver/options,
   starts a fresh read-only reader, verifies the exact checkpoint content,
   identity, revisions and unchanged runtime authority, removes the stopped
   reader by ID, then removes and checks absence of the exact fixture volume.

The two live modes must be separate captured operator requests and separate
Firstmate reservations. Never run `--verify` as an automatic retry of a failed
install. Any failure, timeout, unknown/running container, missing invocation
ID, altered pin, foreign volume or cleanup uncertainty stops the sequence.
The exact volume is retained for human reconciliation; no broad or forced
cleanup occurs. Use `roe-coordination status` and the registered Firstmate
recovery path. A successful install intentionally leaves the volume until the
separately reviewed verify run. If verify is never run, it remains and requires
explicit human reconciliation.

Passing would prove a credential-free TypeScript semantic checkpoint survives
across **separate operator processes and reservations** on the reviewed private
volume scope. It would not prove an installed role launcher, native Codex
transcript resume, authentication/inference, Herdr restart, or Claude/Pi
adapter acceptance. `roe-role` activation stays disabled.
