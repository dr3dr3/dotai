# Inert live Unix socket acceptance

Executed successfully on 2026-09-28. Builds on the successful pidfd-only startup comparison.
Human execution only, under a registered Firstmate runtime reservation.

`python3 run.py` verifies input pins and prints the plan without starting Docker.
`--execute` uses the same pinned image, nono binary and single-syscall seccomp
policy as the preceding comparison. No capability, network, host mount,
credential, real control socket or agent is supplied.

The static C fixture opens two private listening sockets before nono starts.
Unsandboxed positive controls connect to both, and prove both bind locations are
usable. Listener descriptors are close-on-exec so the restricted child cannot
inherit them. The parent keeps listeners alive until the restricted child exits.

Acceptance: allowed socket connect succeeds; live ungranted socket connect fails
with EPERM/EACCES; owned-subtree bind succeeds; sibling bind fails with EPERM/EACCES
even though its filesystem directory is writable; exec-child inherits denial.
A missing fixture or ECONNREFUSED never counts as a successful denial.

All capability sets must remain zero. Exact container cleanup is verified. The
fixture has a 45-second alarm, enclosing container a 60-second timeout, and client
a 75-second timeout. Any failure retains the reservation for reviewed recovery.
No automatic recovery or grant expansion. Abstract sockets, network filtering,
actual Codex sockets and restore are outside this bounded test.

Build (preparation only):

```sh
cc -static -Wall -Wextra -Werror -O2 socket-probe.c -o /workspace/tmp/ai-pilot-socket-probe
```

pins.json records reviewed source, executable and policy hashes. Rebuilding or
changing any input requires review and repinning. Temporary policy provenance is
in ai-context/plans/active/2026-09-macbook-ai-pilot-seccomp-experiment.md.
Do not treat this experimental historical Docker policy as an installed baseline.

## Observed result

Capture `/workspace/tmp/ai-pilot-nono-sockets-20260928111633.log` ends DONE rc=0.
All positive controls and five restricted checks passed. nono logged the three
expected IPC denials; its suggested grant flags must not be applied to these
intentional negative tests. All capability sets were zero; exact container
cleanup verified and runtime reservation released. Remaining limitations above
still apply; this does not activate real roles.
