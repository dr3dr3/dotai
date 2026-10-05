# Inert network acceptance

Executed successfully by the captain on 2026-09-28 under the registered Firstmate reservation.
Default `python3 run.py` verifies hashes and prints the plan; it starts nothing.

One disposable container uses the proven pidfd-only seccomp policy, all Linux
capabilities dropped, non-root user, read-only root, resource limits and timeouts.
It changes network=none to network=bridge. No application network, published ports,
host mounts, host proxy settings, account credentials or model calls are included.
Docker bridge supplies outbound connectivity; nono restricts the tested child.
The supervisor is not itself restricted to the child's allowlist.

The exact bundle is recorded in bundle.json and hash-pinned in pins.json. It
contains existing nono, a static TCP fixture, installed curl plus its resolved
shared libraries and public CA bundle, and the test profile/scripts. No installs.
The proxy session authenticator is ephemeral, injected by nono, and never printed.

Acceptance:
- Parent-owned localhost listener is reachable before sandboxing (positive control).
- Child direct TCP connect returns EPERM/EACCES, including an exec-child after
  clearing proxy variables. Refused/timed-out/unreachable does not count.
- Allowlisted https://example.com/ returns HTTP200 and expected Example Domain
  content using curl with explicit CA verification. No redirects or insecure TLS.
- Unlisted example.org CONNECT returns explicit proxy403 with curl nonzero.
  Authentication errors, DNS failures and upstream outages do not count as denial.
- All five capability sets zero and exact named container absent after completion.

Unexpected results stop; no automatic recovery or grant expansion. The control
listener stays alive in the parent and is CLOEXEC. Per-process alarm50, container
60s and client75s bound the test. Curl has connect8s/total15s and 64KiB response
limit. No real services or metadata endpoints are probed directly.

This establishes only these network cases. It is not comprehensive egress testing,
provider authentication/inference, real role profiles or restart/restore approval.

## Recorded outcome

Capture `/workspace/tmp/ai-pilot-nono-network-20260928120812.log` ends DONE rc=0,
elapsed2s. All declared acceptance checks passed; curl56 with CONNECT403 was the
required negative test. Exact container removed and runtime available. This
result does not enable real roles or change the limits stated above.
