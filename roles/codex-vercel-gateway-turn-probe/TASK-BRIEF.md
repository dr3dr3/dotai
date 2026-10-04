# Firstmate registration brief: codex-vercel-gateway-turn-probe

Register a **new**, queued, metadata-only, operator-only scout with
`worker_dispatch=none` only after `GATEWAY-PREFLIGHT.md` is complete. This is
independent personal tooling, but any shared runtime operation requires its
own Firstmate reservation. Registration itself must start no worker, Docker,
Codex, model call or reservation. Do not reuse `codex-provider-turn-probe` or
any earlier checkpoint/startup task.

Source: `/workspace/.ai/dotai-codex-vercel-gateway-turn`, branch
`feat/codex-vercel-gateway-turn`. Bind clean committed HEAD and exact SHA-256
of `roles/codex-vercel-gateway-turn-probe/run.ts` and `pins.json`; run
`node roles/codex-vercel-gateway-turn-probe/run.ts --bundle-check` before
registration. The native Codex 0.157.1 ARM64 ELF remains pinned at SHA-256
`9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`;
no re-pin is authorised by this gate. The container image, engine, nono and
seccomp pins are verified by the runner and listed in `pins.json`/`run.ts`.

The proposed reserved command is:

```text
roe-coordination run --home /workspace/.firstmate-home --task codex-vercel-gateway-turn-probe -- node /workspace/.ai/dotai-codex-vercel-gateway-turn/roles/codex-vercel-gateway-turn-probe/run.ts --execute
```

The captured Operator wrapper must prompt for a freshly created dedicated
Gateway key through hidden terminal input. It must set only the reviewed
attestations `ROE_PILOT_GATEWAY_KEY_BUDGET_USD=1`,
`ROE_PILOT_GATEWAY_KEY_BUDGET_PERIOD=none`,
`ROE_PILOT_GATEWAY_TOPUP=off`, and
`ROE_PILOT_GATEWAY_KEY_ISOLATED=yes` after the human verifies them. These are
not independent billing checks. Never put the key in argv, task metadata,
transcript, git or a shared HOME. The key is visible to the disposable Codex
process and Docker inspect while its container exists.

The runner clones installed `roe-role-pilot-state-v1` read-only into one
disposable private volume. Its four setup containers have `--network=none`.
The single turn container has `--network=bridge` and nono allows only
`ai-gateway.vercel.sh`; its Codex provider is the Responses-compatible
`https://ai-gateway.vercel.sh/v1` with model `openai/gpt-6-luna`. It uses the
same pinned image, zero capabilities, no-new-privileges, pinned seccomp,
read-only root and resource/time limits as the direct fixture. No host
workspace, shared HOME, Docker/Herdr socket or role instruction directory is
mounted. The one prompt asks for an exact synthetic marker and rejects tool
activity. Gateway credit usage is separate from ChatGPT subscriptions.

Acceptance requires a completed turn with exact marker output, clean exit,
exact removal of the credentialed container and clone, preservation of the
installed volume, a captured Operator log ending `DONE rc=0`, key revocation,
and a fresh `roe-coordination status` showing available. On failure, remove
the exact credentialed container and revoke the key; retain the private clone
and reservation for Firstmate reconciliation. If container removal fails,
revoke the key immediately. Do not retry or bypass a refusal.

A pass proves only Codex provider authentication and one inference turn
through Vercel AI Gateway. It does not prove direct OpenAI API auth,
subscription-backed Codex, native transcript resume, container persistence,
Herdr restore or Claude/Pi adapter acceptance. `roe-role run` stays disabled.
