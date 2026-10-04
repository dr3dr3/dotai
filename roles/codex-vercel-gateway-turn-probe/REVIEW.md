# Codex Vercel Gateway turn: offline fixture

This fixture is a distinct branch from the direct OpenAI API project fixture.
André reported $7 of existing Vercel AI Gateway credit and model availability.
The only proposed live action is one synthetic Codex app-server turn through
`ai-gateway.vercel.sh`; no account setting, credential, runtime result or model
call has been verified during offline preparation.

The model is pinned to `openai/gpt-6-luna`, the Responses-compatible endpoint
to `https://ai-gateway.vercel.sh/v1`, and nono's outbound allowlist to that
single Gateway domain. The app-server client accepts only one exact marker
answer from a completed turn and rejects server requests, tools, failed
turns, wrong answers and timeouts. It prints no raw protocol payload, answer
or secret. The native Codex, image, nono and seccomp pins are inherited and
revalidated, not silently changed.

The proposed spending guard is a newly created dedicated Gateway API key
with a nonresetting $1 budget, verified $0 spent, and auto top-up off. Vercel
checks the budget before a request; the crossing request can exceed $1. The
runner's environment checks are only operator attestations, so preflight
account review remains necessary. A Gateway API key budget applies to this
request; a Vercel project budget does not. No BYOK provider key is used.

Only offline/static verification is authorised before a clean commit,
Firstmate registration and captured Operator request. The direct OpenAI
fixture and its $40 project preflight remain paused. Normal Codex/Claude
subscription use, native transcript resume, Herdr restore and independent
Claude/Pi adapters are later gates. Role activation remains disabled.

## Offline evidence, 2026-10-04

- `node --test client.test.ts run.test.ts`: five passed, including exact
  marker, wrong-answer, failed-turn and tool-activity scenarios.
- `node run.ts --bundle-check`: 272,660,480 bytes, SHA-256
  `255a927a4303e4280997714039864b860f68c4566c009f13018aacd45beab29a`.
- Exact native Codex ELF SHA-256 was rechecked as
  `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
- `nono profile validate --strict`, `node --check` for runner/client, and
  `sh -n entry.sh` passed.
- With both runtime token and Gateway key removed from the environment,
  `run.ts --execute` refused `Firstmate reservation required` before Docker.

These checks prove source and offline protocol behavior only. They do not
prove a Gateway request, account balance/budget, Codex inference, credential
cleanup or state restoration.

Sources:
- https://vercel.com/docs/ai-gateway/sdks-and-apis
- https://vercel.com/academy/ai-gateway/codex-with-gateway
- https://vercel.com/docs/ai-gateway/observability-and-spend/budgets
- https://vercel.com/docs/ai-gateway/pricing
