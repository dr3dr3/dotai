# Credential-free provider egress gate

Prepared 2026-10-03 in the independent personal-tooling lane. This is a new,
disposable nono profile for one endpoint check. It does not alter any installed
role profile, enable `roe-role`, or handle a subscription credential.

`node run.ts` prints the exact command and performs no Docker operation.
`node run.ts --bundle-check` verifies all pinned inputs and constructs the
streamed payload without Docker. Only a registered Firstmate task and a live
`roe-coordination run` reservation may use `--execute`.

One non-root, read-only, capability-free container receives no host mount,
volume, HOME, workspace, Docker/Herdr socket, credential, request body or model
call. The pinned fixture uses `nono` to allow only `api.openai.com` from its
child. The request is an unauthenticated HTTPS GET `/v1/models`; acceptance
requires proxy CONNECT 200, certificate verification result 0, and HTTP 401.
Response bodies remain inside disposable `/tmp` and are not logged. The same
child must get explicit proxy CONNECT 403 for unlisted `example.org`, and
direct TCP must be permission-denied both before and after exec with proxy
variables removed. The parent has a localhost positive control.

The runner refuses changed hashes, engine pin, unexpected status or missing
evidence. It prints the exact container ID when one exists and retains the
container and reservation on failure; there is no retry, policy widening or
automatic recovery. A passing run removes the exact stopped container and
verifies absence. This gate cannot prove authenticated Codex traffic, WebSocket
upgrade, model inference, native transcript resume or role restore.

## Reported runtime outcome and evidence limit

André reports a successful direct run through `roe-coordination` on 2026-10-03.
The coordination event log shows `provider-egress-probe` reservations acquired
and released, and current status is available. The direct run did not use the
operator capture wrapper, so no transcript of the fixture's HTTPS response,
denials or exact cleanup was saved. At that point, the separately prepared
operator request `992f0af266144e3fa5d8634124bc73db` was still pending and
did not supply execution evidence. The later captured run below resolves that
evidence gap.

The same reviewed request was subsequently executed through the Operator pane
at 2026-10-03 10:45 UTC. Its record finished with exit 0 and captured
`/workspace/tmp/provider-egress-gate-992f0af2-20261003104504.log`, ending
`DONE rc=0 elapsed=1s`. That log contains the exact localhost control,
direct-network denials, TLS-verified CONNECT 200 plus unauthenticated HTTP 401
from `api.openai.com`, explicit CONNECT 403 for unlisted `example.org`, five
zero capability sets, exact stopped-container removal, and the passing outcome.
Reservation `84c8253085dadb4f` was released; runtime status is available.
This is the captured acceptance evidence for the credential-free egress gate.
Authentication, inference, Codex WebSocket transport and role restore remain
unproven.
