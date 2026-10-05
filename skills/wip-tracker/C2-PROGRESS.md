# C2 trusted transport — implementation and activation gate

Accepted directly from André's “proceed”, 2026-09-29, following the proposed
bounded C2 integration. Lane: personal independent tooling. Coordination status
read: runtime available; no runtime operation performed. Feedback stays disabled.
No commits or pushes. Sibling launcher, role catalogue, profiles and global
accepted briefs remain untouched.

## What is implemented

`scripts/continuity_collector.py` is a trusted, one-shot filesystem collector over
the same continuity store. It accepts an operator-held binding file with:

- `version: 1`, registered `session`, stable `producer`;
- absolute private `outbox` and separate `inbox` paths;
- `grants`, each naming `thread` and `assignment_revision`; a receiving grant also
  names the exact `handoff` and `handoff_revision`.

The binding is configuration, not another work registry. Work, acceptance and
revisions remain authoritative in SQLite. A role gets write access to its outbox
and read access to its receipt inbox only. The binding, database, collector source
and other sessions' channels must stay outside its grants. This access separation
is an integration requirement, not a claim that today's profiles install it.

The collector walks directory components with no-follow directory descriptors,
reads only owner-held single-link regular 0600 files in 0700 directories, rejects
traversal/symlinks/hardlinks/FIFOs, bounds payloads to 64 KiB and batches to 200
files, rejects duplicate JSON keys, and sorts a batch by producer sequence.
Event filenames must match their UUID. Allowed contributions are checkpoints and
handoff protocol transitions; registration, observation, launch, arbitrary store
mutation, feedback and broad queries are not exposed to the child channel.

Store authorization now supports a trusted precommit validator. Grant checks
and mutation share the same immediate transaction, avoiding a race with another
accepted handoff. No schema change or migration was needed. Exact event replay
still returns the durable prior result, including after receipt publication fails.

Receipts contain only event ID, committed flag, success flag and fixed result code.
They are atomically published and fsynced. A missing receipt means unknown;
`committed:true, ok:false` is a durable rejection, not accepted work. The producer
retains an unacknowledged event and removes only its exact unchanged acknowledged
file. The collector never unlinks a path the contributor may have replaced.

`instructions(binding)` generates the personal contribution instructions for
both intake and direct-entry sessions. It grants no runtime/launch authority and
explicitly disables feedback. It is source-only: not injected into an installed
skill or running session.

## Verification

Final run 2026-09-29: **56 tests passed** in approximately 2.7 seconds (47 C1
regressions plus 9 C2 transport tests). New-file whitespace checks emitted no
errors. The sibling dirty-file set remains outside this change. No commits.

Source SHA-256 at this validation point:

| File | SHA-256 |
|---|---|
| `scripts/continuity.py` | `274df68e90992d38992ec50180a70e8ae7e9152fc5ca6f12184b28ff1ee4a837` |
| `scripts/continuity_collector.py` | `8dedea5104a459f4b71d44796793aca2346cf1703551eedc98e9a152f68f5be7` |
| `tests/test_continuity_collector.py` | `25f8f16b7532099e7921685553e6943a6d7e10e6e2d765cc03cdf4c7f0507349` |

The C1 progress file retains its earlier validation fingerprints; the core
engine fingerprint above supersedes that version for C2. Its SQLite schema and
installed skill entry point have not changed.

The C1 47-test suite remains the regression baseline. C2 adds filesystem-channel
tests for durable receipts/replay, accepted handoff ingestion while a separate
inert receiver process remains open, spoofed provenance, ungranted/stale
assignments, exact receiver grants, unsafe files, feedback rejection before the
general journal, lost receipt recovery, binding/private-path checks, and sequence
ordering for dependent batch events. All data/processes are local inert fixtures.

Run from dotai:

```text
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s skills/wip-tracker/tests -v
```

## Live blocker verified from source

Read `roles/README.md`, `scripts/roe-role`, and `scripts/roe_role_harnesses.py`.
The launcher still has an unconditional `ACTIVATION_BLOCKER`; Codex is a disabled
candidate, Claude/Pi are unverified, and native resume refuses an implicit last
session. Provider authentication/inference and restart/restore verification remain
unproven in these records. No agent launch, role preparation, credential access,
sandbox weakening or live store initialization was attempted here.

**C2 is not operational yet.** This change completes the trusted transport source
that can be validated independently of that gate. The real end-to-end journey
cannot honestly be claimed until the sibling-owned launcher is verified and wired.

## Exact integration handoff after the gate passes

1. Trusted launcher, after verified provider identity: call the existing
   `register`/`bind-provider` contract using a stable launch attempt, environment,
   role/profile and evidence-backed native session/resume reference. A direct
   launch uses exactly the same contract; no Claude-only environment inference.
2. Create/link the thread as the operator, then prepare an owner-held binding and
   per-session channel directories. Grant the child only outbox write/inbox read.
   Load `instructions(binding)` plus the narrow assigned thread/brief snapshot
   through the adapter's personal instruction loading path. Do not expose a DB
   path, trusted binding, arbitrary collector command or another session's data.
3. During the session, the trusted operator/supervisor invokes a bounded collection:
   `continuity_collector.py --db <verified-store> --binding <trusted-binding>`.
   It must run while the receiver is open, not only after exit. No scheduler or
   background polling loop is installed here. Live supervisor trigger selection
   belongs with the verified harness integration.
4. Receiver binding names one exact handoff revision. Its acceptance permits
   subsequent contributions for that accepted assignment; it does not transfer
   runtime authority. If ownership changes again, the old channel refuses writes.
5. Trusted lifecycle hooks alone emit `observe` with actual observation time/source.
   Lost attachment is unknown; verified child exit may be exited; neither completes
   the thread. Never infer a resume command or start a duplicate executor.
6. Add the agreed Concierge catalogue/charter entry and narrow workspace routing in
   the sibling-owned integration files after coordinating that ownership. Preserve
   unrelated panes and the two-pane-per-topic limit. No inter-session messages were
   sent by this work.
7. Verify the selected persistent local store directory and permissions, then
   explicitly initialize it as part of activation. Run the proposed no-runtime
   discussion journey: intake → explicit acceptance → checkpoint/park → fresh
   rediscovery, followed by direct entry and abrupt exit. Feedback remains disabled
   unless André separately approves its proposed settings and real-work trial.

Next dependency: the original pilot implementation session's verified launcher/
provider/restore boundary. André can continue that work there; this conversation
owns the continuity transport integration and subsequent real journey.

## Verification ownership transferred — 2026-09-29

André explicitly transferred launcher verification to this conversation after the
ownership clarification (“yes, proceed”). Existing captain-only runtime, credential,
model-trial and sandbox approval boundaries remain in force. This supersedes the
next-actor routing above; no global accepted handoff or sibling source was edited.

At takeover, coordination showed retained reservation `5efb07d11a1e9a1c` for
`nono-session-probe` in `/workspace/.firstmate-home`. The complete capture
`/workspace/tmp/ai-pilot-nono-session-20260929011028.log` ends DONE rc=1 elapsed3s
on instance 1. Restricted read denials passed and app-server spawning was logged;
the last child stage was protocol initialization. No reply or outer exit/stderr
diagnostics appeared. Root cause remains unknown, not a demonstrated persistence
failure. The runner recorded exact container `roe-nono-probe-911383f2b69b` absent.

The prior owner already prepared `/workspace/tmp/session-exit-evidence.sh`, with
inner script scoped to Docker events at 01:10:20–01:10:45 UTC for that exact
container, exact inventory and coordination status. Both shell syntax checks pass.
It performs no recovery, retry or grant change. The registered task brief requires
captain execution in a human shell. This session will read the full captured
result before preparing any next action. An empty historical event query is
inconclusive, since event history is bounded.

Current tab already contains two panes; preserve that layout and provide the
existing capture-wrapper invocation rather than adding a third pane.

The 01:40:08 exit-evidence log was then found and read in full: DONE rc=0,
instance 1; event query and exact inventory returned no rows. This does not
establish the cause. A fresh coordination read showed runtime available. Who
cleared the earlier reservation is not established; no recovery was run here.

Prepared the next same-scope diagnostic in the now-transferred
`roles/nono-session-probe/run.py`: private cidfile, print stopped container state
before removal, exact-ID non-forced cleanup, and refusal on missing/running/
uninspectable identity. Preserved all grants, resource ceilings, network-none,
no-credentials and no-turn boundaries. Eight offline tests pass, including four
new runner tests. All other existing pins verified unchanged. Reviewed runner
SHA-256: `cead0513744c80291bb23038e6944992d8cebb7382e32e935410a8e9cfc7584b`.
Only that pin was updated; no automatic repin or runtime invocation occurred.

Next action: captain executes the existing `/workspace/tmp/run-session-check.sh`
capture wrapper under registered `nono-session-probe`. Read its complete result,
especially `CONTAINER_EXIT_STATE`, before attributing a cause or proposing a fix.
The task brief's human-shell requirement prevents this agent from executing the
container probe itself. No provider trial or role activation is yet authorised.

### Concurrent-edit stop and new evidence

The final plan-only check failed: the original pilot session had independently
added exit inspection/removal while this session was doing the same. The shared
runner now contains overlapping operations (duplicate `--rm` removal and duplicate
cleanup). **Do not run the current working-tree probe or treat its pin as a validated
candidate.** The eight unit tests above tested the helper but did not catch the
overlap in `main`; the plan check did. No live invocation was issued here.

Asked André to pause the left session's edits before reconciling the transferred
source. Preserve its useful exit-state checks; review one resulting runner and
repin only after whole-path plan validation. No ownership-transfer message was
sent to another session.

Found and read complete capture
`/workspace/tmp/ai-pilot-session-exit-retry-20260929025432.log`: DONE rc=1 elapsed2s,
instance 1. Its earlier candidate reached protocol initialization then exited.
Docker State reports ExitCode=1, OOMKilled=false, Running=false, Status=exited,
Error empty. Exact container `roe-nono-probe-ff1d8ec29f01` was removed. This rules
out a Docker-reported OOM for this attempt, not every possible process failure.
Reservation `698446c1f1ba4617` is retained. No recovery or next runtime attempt
has been performed by this session. The current overlapping source is newer than
that execution and must be repaired separately from diagnosing the original exit.

### Coordinated ownership and reconciled candidate — 2026-09-29

André explicitly authorised coordination with the original pilot session. Sent
the transfer/pause request through Herdr to `w1:pS`; its reply confirmed Concierge
ownership and paused probe, pin and related launcher edits/execution. No operation
was running there. No continuing inter-session reporting is required.

This supersedes the invalid-candidate warning above. Reconciled `main` to remove
`--rm` once and use one exact-ID evidence/cleanup helper. Preserved the other
session's direct synthetic stderr stream and shell tracing; added bounded stored
Docker logs before cleanup. Require stopped/exited state; timeout retains the
container for review. No grants, runtime ceilings or protocol calls changed.

Nine offline tests pass, including a new full plan-entrypoint regression that
forbids runtime subprocess calls. Separate plan-only execution verifies all pins
and exits 0; shell syntax checks pass. Reviewed runner SHA-256:
`d43e4ce02104446c2a54df3ab5c78c18ecce989f65789be914ec914fb1b20999`.
Latest coordination read: runtime available. No recovery or container execution
performed here. The previous initialization exit remains unexplained.

Next: captain runs `/workspace/tmp/run-session-check.sh`, which captures output
and acquires the registered task reservation. Do not use the separately prepared
recovery/retry wrapper: no retained reservation was observed at this handoff.
Read the complete resulting log before deciding another change. Human-shell
execution is required by the registered task brief. Real roles remain disabled.

### Captain diagnostic result — 2026-09-29 05:23 UTC

Read complete `/workspace/tmp/ai-pilot-nono-session-20260929052303.log`.
The pinned Codex app-server initialized in the no-turn nono child, created a
non-ephemeral thread, returned an explicit thread ID, and accepted its name.
After clean first-process shutdown, the fixture found no
`CODEX_HOME/sessions/**/*.jsonl` rollout. It stopped by design before process
restart: zero-turn identity recovery was **not** established. The app-server
also logged a proxy HTTP CONNECT 502 for its startup websocket attempt;
the log does not establish that this caused the missing rollout.

Docker State: ExitCode 1, OOMKilled false, Status exited. Stored Docker logs were
captured; exact container `3ae5e1d73ee97e509a04b9aba788015b21bd9800548fb6e22fe258fa35cb4ec4`
was removed, and name inventory confirmed absence. Runner acceptance failed.
The registered task retains reservation `7151c59218fe33de`; coordination
confirmed it after the run. No retry or automatic recovery. The brief calls
for explicit human reconciliation after failure. This result closes only the
no-turn fixture question for this candidate: live restore, inference, model
authentication and real roles remain unverified and disabled. Any model-turn
trial needs a separately authorised task and security review.

### Recovery check — 2026-09-30 09:21 UTC

André ran the guarded recovery script; complete capture:
`/workspace/tmp/ai-pilot-session-recovery-20260930092111.log`.
It found the runtime already available, made no recovery call, and exited 0.
A separate `roe-coordination status` read also reports available. Who cleared
the previously retained reservation is not established by this capture. No
retry, runtime mutation, or real role launch occurred in this session.

### Proposed single-turn follow-up — 2026-09-30

André asked this session to proceed with preparing a bounded single-turn probe
for review. New isolated source under `roles/nono-one-turn-probe/` contains an
offline protocol contract, five fake-message acceptance tests and `REVIEW.md`.
It has no runner, credential reader, Docker call or launch entry point. The
existing registered task forbids inference and remains unchanged.

Official OpenAI app-server docs and the pinned local Codex 0.157.0 generated
schema informed one `turn/start`, exact `turn/completed` status/identity,
synthetic marker, and exact-ID `thread/resume` design. The protocol gate rejects
observed tool items/server requests, wrong reply, failed/interrupted status and
identity mismatch. This detection is not a preventive tool sandbox.

Review blockers before a runnable probe: exact credential ingress and refresh
without streaming the OAuth store or sharing HOME; provider endpoint egress and
direct-TCP denial through nono; reviewed model and one-turn spend allowance.
The previous fixture had `--network=none` and no credential. The candidate
read-only exact-file auth mount would be a new grant needing André's explicit
approval, plus host-source mapping review. No credential content/path was
inspected, no provider call was made, no reservation was acquired and no runtime
or sandbox setting changed. Coordination was available at scope check. C1/C2
implementation and role activation remain as previously recorded.

### Existing subscription credential volume — 2026-09-30

André approved investigating login-based Codex and Claude use on his plans.
Static Compose and read-only mount metadata show the existing
`roe-devcontainer-ai` volume at `/home/vscode/.ai`; `.codex` and `.claude` are
symlinks into its `codex` and `claude` directories. Both expected credential
files exist, mode 0600. `codex login status` reports ChatGPT login; `claude auth
status --text` reports Claude Max. No API-key override variables are present in
this shell. No credential file content was read, copied, mounted elsewhere or
logged. This establishes the source for a proposed exact read-only Codex file
mount, but not a usable child credential or refresh path. Docker's
`volume-subpath` could select only `codex/auth.json`; its actual engine behavior,
resolved volume name and nono grant need an inert reserved preflight. Claude has
no implemented role adapter yet. No model, Docker or live login action followed.

### Synthetic credential-file mount preflight prepared — 2026-10-01

André said “proceed.” Coordination status was available, and the old
`nono-session-probe` brief still explicitly forbids inference. Prepared a new
operator-only Firstmate task request in
`roles/nono-one-turn-probe/PREFLIGHT-TASK.md` and a default-plan-only synthetic
fixture in `roles/nono-one-turn-probe/volume_preflight.py` (SHA-256
`61e35c577de8486a914624fcf3984f51ca8750c1e44388ecb8c9c0abb68d97b4`).
Two offline safety tests pass. The fixture names no real AI volume or credential,
uses network-none containers, and tests only whether pinned Docker can mount a
single synthetic file subpath read-only; it removes its exact temporary volume.

Routed a new task registration request to the existing Firstmate pane. That pane
stopped at its own approval prompt for a read-only brief/status command. It has
not registered the task or run Docker. The initial Herdr shell call expanded
Markdown backticks in the transmitted message, so exact path and task-ID
references must be confirmed with Firstmate once its prompt is cleared; the
task file above is authoritative. No credential contents were read and no
runtime reservation was acquired. Do not execute the fixture until Firstmate
registers the new exact task and the captain reviews the command.

### Firstmate TypeScript replacement and review — 2026-10-01

Checked the Firstmate pane after André selected TypeScript/Node for new AI-setup
work. Firstmate registered `ai-auth-file-subpath-preflight`, put the Python route
on hold, created its own `volume_preflight.ts`, `test_volume_preflight.ts` and
`PREFLIGHT-TASK-TS.md`, updated the queued task, then removed the hold. Our
concurrent TypeScript test file was removed; Firstmate owns those three files.
No Docker or real credential operation occurred. This supersedes the earlier
pending-registration state, but the historical Python brief is not a route.

Review found two gaps: file mode 0400 plus `test ! -w` did not demonstrate a
read-only Docker mount; and the captain route borrowed `tsx` from another repo
although local Node 22 runs `.ts` directly. Firstmate accepted both findings
and is revising its source/tests and task brief. At this record update, its
source SHA-256 is `79e8c35003343bc43824a60b16fbe228f95175c460af25505ed760d37b223861`,
while the task brief still pins the old hash. The Firstmate pane is waiting for
André's approval of a read-only `sha256sum` command before it can repin and
update the task. **Do not execute the unheld task while these differ.**
Coordination still reports runtime available; no reservation acquired.

### Reviewed TypeScript task ready for captain — 2026-10-01

The Firstmate owner accepted the safety review, added an attempted `chmod`
denial plus mode check, added engine-mismatch and failed-writer cleanup fixtures,
and changed the route to direct Node 22. Four offline tests pass independently
with `node --test`. The current source SHA-256 and registered task brief agree:
`79e8c35003343bc43824a60b16fbe228f95175c460af25505ed760d37b223861`.
Task `ai-auth-file-subpath-preflight` is queued, unheld, operator-only. The
earlier stale-hash warning is resolved; neither session ran Docker.

Submitted one frozen `local-runtime` operator request:
`/workspace/tmp/operator-requests/f5f5a98cf1344c9a8c275f4c601b9129.json`.
Its status is pending; frozen script SHA-256 is
`78bdfb2fbde54859c154665c484a13775516f37d0b312c5ac4a49dfed2643993`.
It checks Node version and exact TypeScript hash, then runs only the registered
synthetic fixture through `roe-coordination run`. André must inspect and run it
in his operator pane. No reservation was acquired by submission. Read its full
captured result and coordination state before deciding any provider egress or
credential step. The real auth volume remains untouched and roles disabled.
