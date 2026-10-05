# Firstmate registration request: provider-egress-probe

Lane: independent personal internal tooling. Register a metadata-only,
operator-run task; do not launch a worker, Codex role, Baxter or Quality.
Firstmate coordinates the runtime reservation only. No provider credential,
model invocation, state volume or sandbox change to installed roles is requested.

## Reviewed source and pins

- Runner: `/workspace/.ai/dotai/roles/nono-provider-egress-probe/run.ts`
  SHA-256 `86bc82885a6fa0b5f94a3525b0dfea4a7cf302498e32e15aad3245396ff41ada`.
- Pin manifest: `pins.json` SHA-256
  `6768843728e72679c0797355ba9c7016843b367ae3c920b2112da88b44fd87ab`.
  It covers every streamed file, nono binary, and seccomp policy.
- Nonzero bundle inputs are current pinned curl, resolved arm64 libraries,
  public CA bundle and the prior static TCP fixture; no Python is invoked.
- Offline payload: 46,991,360 bytes, SHA-256
  `dc49f361c3ea598eaa3b05bdc98ac5ecc10d9d3712f45323a2936851b00d4071`.
- Docker image `sha256:786a8b558f7be160c6c8c4a54f9a57274f3b4fb1491cf65146521ae77ff1dc54`;
  engine 29.4.0 / daa0cb7f / arm64; nono 0.76.0, SHA-256
  `520433bc42ee9938a154867b965a243e9cfa348a3a1987fb7422c1bff653b4e9`.

Offline checks passed: Node source syntax, `node --test test_run.ts` (6 tests),
shell syntax, `nono profile validate`, and `node run.ts --bundle-check`.
The latter and default run make no Docker call.

## Exact captain command after registration and fresh status

```text
roe-coordination run --home /workspace/.firstmate-home --task provider-egress-probe -- node /workspace/.ai/dotai/roles/nono-provider-egress-probe/run.ts --execute
```

The runner prints its unique container name and exact command. It uses one
bridge-network disposable container with `--pull=never`, read-only root,
non-root UID, all capabilities dropped, no-new-privileges, pinned seccomp,
CPU/memory/PID limits and 60/75-second timeouts. No host bind, volume,
application network, published port, socket or environment inheritance.
The only child allowlist entry is `api.openai.com` in a probe-specific profile.

Pass: parent localhost TCP control; child direct TCP EPERM/EACCES including an
exec child with proxy variables cleared; `https://api.openai.com/v1/models`
unauthenticated GET yields CONNECT 200, TLS verification 0, HTTP 401; unlisted
example.org yields explicit CONNECT 403 with nonzero curl; all five capability
sets zero; exact container removed and absence verified. Proxy 502, DNS errors,
timeout, 429, changed 401 behavior or any unexpected response are inconclusive,
not a pass. Failure retains the exact container and reservation for human
`roe-coordination status`/`recover` reconciliation. No retry or grant expansion.

This does not test the Codex WebSocket route or provider auth/inference. Do not
use the older `nono-network-probe` task or the checkpoint task for this run.
