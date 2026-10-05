# Inert nono startup comparison

Prepared, not executed. No agent launch is included.

`python3 run.py` prints the baseline Docker argument vector without executing.
`python3 run.py --case ptrace` prints the comparison case. `--execute` starts
one disposable container and requires both explicit approval for its security
settings and the existing Firstmate runtime reservation. The script grants
neither. Never invoke execution directly around `roe-coordination run`.

## Exact scope

- Existing Ubuntu 24.04 arm64 image, pinned by full local image ID; no pull/build.
- Pinned installed nono 0.76.0 binary (SHA256 verified before execution).
- No network, host mounts, Docker socket, application network, model calls or
  credentials. Four explicit files streamed over stdin into a disposable tmpfs.
- User 1000:1000; all capabilities dropped. Comparison adds only SYS_PTRACE.
- Default Docker seccomp retained; no `unconfined` or custom policy.
- Read-only root filesystem, no-new-privileges, 512 MiB RAM/swap ceiling, one CPU,
  64 processes, 128 MiB tmpfs, 60-second outer timeout and automatic removal.

Adding SYS_PTRACE changes the container's capability configuration and may also
change Docker's conditional syscall allowance. Effective capabilities for this
non-root user are printed rather than assumed. This experiment does not isolate
those two mechanisms by itself and is not authority to change the devcontainer.
A custom syscall-only profile remains deferred until its engine-matched baseline
can be established; fetching current upstream main is not a version match.

## Measurements

The entry script first proves the inert denied-path fixture is readable/writable
without nono. The restricted child then checks allowed output, denied fixture
read/write, inherited child restriction and environment filtering. Startup uses
domain filtering and pathname Unix socket mediation to exercise the failed path.
No external traffic can leave the container, so success is **not** evidence of
working domain allow/deny enforcement or allowed provider access. Live socket
checks, actual role profiles, inference and recovery remain later tests.

Record each case's return code and output. If timeout, missing libraries or
another setup error occurs, classify it separately from the original EPERM.
On client timeout inspect only the printed unique container name through the
reservation. Do not remove unrelated containers or retry with wider privileges.

## Runtime handoff

Ask the existing Firstmate to arrange a bounded reservation for these two cases,
after André explicitly approves the comparison's SYS_PTRACE setting. No stack
staging, service restart, database access or code checkout change is involved.
Use a real registered home/task ID; none is fabricated in this prototype.
The authorised operator runs both cases, retains both exit codes, and returns
the log. This script does not start or contact Firstmate.

## Fixture correction after first attempt

Both initial cases stopped because granting the child its entire HOME overlapped
nono's protected supervisor state. The profile now grants only the output path;
the child check script does not require home writes. A local temporary-home
regression confirmed startup reaches pidfd_getfd rather than the profile-overlap
rejection. The original two-case Docker result is inconclusive and retained in
the ai-context implementation record; rerun only after explicit reconciliation
of its held reservation. No capabilities or network scope were added.

## Corrected comparison result

The corrected 2026-09-28 run reproduced pidfd_getfd EPERM in baseline and passed
all five probe checks with the container SYS_PTRACE configuration. Both cases
reported zero effective/permitted capabilities; the passing case's bounding set
contained SYS_PTRACE. This proves the tested startup configuration works, not
that a process needs effective SYS_PTRACE. No network, real socket, model or
restore acceptance test is included. See ai-context for the evidence and retained
reservation reconciliation.
