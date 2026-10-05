# Credential-free local session and process-persistence probe

Prepared 2026-09-28; earlier revisions executed, **current revision not executed**. Human execution only, under a registered
Firstmate runtime reservation. No role activation follows automatically.

`python3 run.py` verifies pins and prints a plan without calling Docker.
`--execute` starts one disposable container using the preceding probe's pinned
image, engine check and pidfd-only seccomp policy. Network is disabled, all
capabilities dropped, root filesystem read-only, no host mounts or credentials.
Only the disposable /tmp filesystem is writable at the container boundary.
The candidate role profile is generated from the current launcher/adapter and
specialized by removing the authentication-file read grant. No auth file exists.

## What it checks

1. Inert protected/sibling markers are readable before nono and denied in its child.
2. The pinned Codex app-server initializes over stdio without an inference request.
3. Start a non-ephemeral thread, name it, record the returned provider thread ID.
4. Close stdin, require a clean process exit and record whether a local rollout exists.
5. Start a new app-server process using the same isolated state directory.
6. Read and resume the exact recorded ID; require the same identity and saved name.
7. Recheck protected reads and require a clean second exit.
8. Require zero capability sets, expected success markers and exact container removal.

Only initialize, thread/start, thread/name/set, thread/read and thread/resume
requests are permitted by the fixture client (plus initialized notification).
Unexpected server requests are failures, never automatically approved. No turn,
tool execution, login or account request is sent. Response timeout is 12 seconds;
container timeout is 60 seconds plus 5-second kill grace; client timeout 75 seconds.

A zero-turn thread produced no rollout in the 2026-09-29 live run. The current
revision still attempts read and resume after a clean process exit, so the
protocol itself establishes whether the thread persists without a rollout.
Missing auth, startup timeout or resume failure is a failed acceptance result,
not permission to add a model turn, manufacture session files or widen grants.

## Preparation and evidence

`prepare.py` packages only public /usr/bin Python, /usr/lib/python3.12 source and
extension modules, and their ldd-resolved libraries. It does not package HOME,
site credentials, live role state or application files. Its tar is stored in
/workspace/tmp/ai-pilot-session-python.tar and pinned; no runtime installation.
The bundle is copied into the disposable container by the runner, with safe
relative regular-file entries only. No output archive is extracted on the host.

Protocol fields/methods came from the installed pinned Codex 0.157.1 command
`app-server generate-json-schema`; selected schema hashes are recorded in
protocol-evidence.json. Context: [official app-server documentation](https://learn.chatgpt.com/docs/app-server).
The installed schema takes precedence over examples for other versions.

Four offline fixture tests pass: inference/tool/auth methods rejected before
process access; exact identity used after first-process exit; absence of a rollout
still requires protocol recovery; wrong resumed identity rejected. These use fake protocol responses and
do not establish live Codex compatibility. Shell syntax and input-pin plan checks
also pass. Rebuilding with prepare.py deliberately repins inputs and requires
review; the execution path never repins automatically.

## Explicit limits

This tests process restart **inside one container**. Its state is destroyed with
the container. It does not establish container recreation, machine migration,
Herdr native restore, actual Unix socket transport, model authentication or model
inference. Stdio is the only transport exercised. Claude and Pi remain unverified.
No persistent volume, live profile refresh, aliases or daemon is created.
Any failure retains the reservation for reviewed recovery. Never broadly remove
containers or bypass a coordination refusal.

## First live result and diagnostic revision

2026-09-29 capture `ai-pilot-nono-session-20260929002855.log`: rc1 in 2s;
protected-read checks passed, initialization was not confirmed and the underlying
error was not captured. Exact container removal verified; reservation retained.
The revision adds stdout stage markers and outer capture of synthetic server
stderr, without changing grants or requested protocol operations. Four offline
checks still pass. Retry is human-only; root cause and live acceptance are pending.

## Container exit evidence revision — 2026-09-29

Verification ownership transferred explicitly to the Concierge implementation
conversation. The 01:10:28 attempt also failed during protocol initialization;
the outer exit marker was absent. The completed 01:40:08 read-only diagnostic
found no retained events for the exact failed container, so cause remains unknown.
Runtime was subsequently observed available; this conversation performed no recovery.

The reviewed runner now uses a private invocation-specific Docker cidfile and
defers removal until it prints `CONTAINER_EXIT_STATE` (including exit code and
OOMKilled). It removes only that exact ID after proving the container stopped;
it never force-removes a running or unidentified container. Unknown state or
cleanup failure retains the reservation. The existing name inventory check
remains. Runtime limits, image, seccomp policy, profile, credentials prohibition,
network-none and method allowlist are unchanged. No persistence workaround or
model turn was introduced.

Eight offline tests pass: four existing protocol tests plus four exit-evidence
tests using fake Docker responses. Every existing pin except `run.py` was verified
unchanged; only its reviewed digest was updated. The same registered human wrapper
`/workspace/tmp/run-session-check.sh` runs this revision. Its live result is pending.

### Exit-evidence retention revision

The second run reached app-server spawn and protocol initialization, then lost
all subsequent diagnostics, including the outer shell's exit marker. A bounded
historical Docker event query returned no retained events. Cause is unknown.
The runner now omits --rm, captures only the exact container's Docker State on
return, and removes that exact container without force only when confirmed exited.
A timeout or unknown/running state leaves it for reviewed recovery. Sandbox,
resource limits and protocol calls are unchanged; no live result yet.

### Reconciled diagnostic candidate — 2026-09-29

After André authorised direct coordination, the original session confirmed the
ownership transfer and paused edits/execution. Overlapping cleanup edits are now
replaced by one exact-ID helper and one removal of `--rm` from the Docker command.
Direct synthetic stderr and shell tracing are preserved; up to 200 stored Docker
log lines are captured before cleanup. A timeout retains the container for review.

Nine offline tests and a separate pinned plan-only run pass. The full-entrypoint
regression catches duplicate command edits and forbids runtime subprocess calls
in plan mode. Shell syntax checks also pass. The 02:54:32 live attempt predates
this candidate: ExitCode=1, OOMKilled=false, no initialization reply. Its cause
remains unknown. This candidate has not been executed live. Use the existing
human-only `/workspace/tmp/run-session-check.sh` capture wrapper; roles remain
disabled, and all sandbox/resource/protocol boundaries remain unchanged.

### Captain result — 2026-09-29 05:23 UTC

The no-turn app-server initialized, returned a non-ephemeral thread identity
and accepted its name. On clean first-process shutdown no persisted rollout
existed, so the fixture stopped before its restart step. A startup websocket
attempt logged HTTP CONNECT 502; its causal relevance is unknown. Docker exited
1 without a reported OOM, stored logs were captured, and the exact container
was removed. Reservation `7151c59218fe33de` was retained for human recovery.
No process-persistence or restore claim follows from this result. Do not retry
this same candidate expecting a different zero-turn outcome.

### Reviewed 0.157.1 candidate — 2026-10-03

The installed native ARM64 static ELF reports `codex-cli 0.157.1`, is 246724968
bytes and hashes to `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
The parent and platform npm packages both report 0.157.1. All six schema files
selected in `protocol-evidence.json` have the same SHA256 as the 0.157.0
candidate. Only after these checks were the exact binary, role pin, and probe
manifest updated. No PATH wrapper is accepted.

The current client records the observed rollout count, then starts a second
app-server and attempts `thread/read` and `thread/resume` for the exact captured
ID. It sends no turn and accepts no model, tool or auth method. Nine offline
fixture tests, 14 role tests and the pinned plan-only runner passed. These are
source checks only; the live process-persistence result is pending. Continue
using the existing operator-only `nono-session-probe` task and review any held
reservation before running. Role activation remains disabled.

### Live result — 2026-10-03 03:34 UTC

Operator request `3ac4b31a100c4582a91de73c2cc1ef6b` finished rc1. The first
process exited cleanly after creating/naming a thread; rollout count was zero.
The second process initialized, `thread/read` returned without error, and
`thread/resume` failed with `no rollout found for thread id`. This exact native
zero-turn resume path is not accepted. The exact container was removed and its
absence verified; the failed run retained reservation `e27edb26b00204a7` for
human reconciliation. No retry or profile broadening is implied.
