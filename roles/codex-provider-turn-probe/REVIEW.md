# Codex provider turn: offline protocol preparation

Lane: independent personal internal tooling. Runtime status at preparation:
`Runtime: available (reservation required for runtime operations)`.

## Billing scope clarified 2026-10-04

André authorised pay-as-you-go API pricing for this bounded trial, with a $50
budget, and stated that normal pilot use should primarily draw on his Codex
and Claude subscriptions. This API-project fixture is therefore a **one-off
diagnostic**, not the default provider path or acceptance evidence
for subscription-backed operation. It must not be registered or run merely
because the pricing category was authorised: the dedicated project's enforced
$40 threshold, current usage, model scope, data suitability and temporary key still
need review. The subscription path remains a separate acceptance gate.

OpenAI's documented local Sign in with ChatGPT flow can issue a plan-usage OAuth
token for eligible accounts and pass it to Codex app-server through an
environment key. That would require a separate bounded acceptance fixture for
registration, consent, token storage/refresh outside the role, one completed
turn and denial/cleanup. Do not copy a personal OAuth store into the role or
reuse this API-key result as evidence for that flow. Claude Code's subscription
login requires its own adapter acceptance; Pi remains separate and unverified.

Sources:
- https://developers.openai.com/siwc/quickstart
- https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
- https://help.openai.com/en/articles/20001275-chatgpt-work-and-codex
- https://docs.anthropic.com/en/docs/claude-code/getting-started

## Verified offline

- The reviewed native Codex 0.157.1 ARM64 ELF remains pinned at SHA-256
  `9cbc3cdcc18ca336523ffa7d64207a1ae1f5991f823081d0a37bcb3a748de093`.
  This work did not re-pin it.
- The exact pinned executable generated its app-server JSON schema into
  `/workspace/tmp/roe-codex-schema-0157` with an empty temporary home, no
  credential and no model call. `ThreadStartParams`, `TurnStartParams`,
  `TurnCompletedNotification` and `ItemCompletedNotification` were inspected.
- `client.ts` is a TypeScript stdio client for one thread and one turn. It
  accepts only a completed turn with one exact marker answer. A server request,
  tool item, failed turn, wrong answer or timeout refuses. It emits no raw
  protocol payload, stderr, answer, token or provider response.
- `node --test roles/codex-provider-turn-probe/client.test.ts` passed four
  offline fake-server scenarios: complete, wrong answer, failed turn and tool
  activity. The fake uses no provider or network.

## Proposed live boundary, implemented but not yet accepted

Use a new disposable clone of installed `roe-role-pilot-state-v1`; mount the
installed volume read-only only to copy its credential-free state, then never
mount it for Codex. The clone is writable only at the private pilot role paths.
Run a single `thread/start` and `turn/start` under nono, the reviewed container
image, zero Docker capabilities, no-new-privileges, pinned seccomp, memory/CPU/
PID limits and a 65-second limit. The sole network destination remains
`api.openai.com` through nono's proxy; no host workspace, shared HOME, Docker or
Herdr socket is mounted. Use a dedicated, short-lived or capped nonproduction
credential delivered as one named environment variable, not copied from an
existing personal OAuth store. Do not log its value. André approved a
dedicated nonproduction OpenAI API project for this one trial, with a $50
budget. The project must have a $40 monthly threshold with **Enforce a hard
limit** enabled, a restricted temporary key and access to the current
`gpt-6-luna` Responses model. API usage is billed separately from ChatGPT
subscription usage. The project settings are not yet verified or provisioned.
`run.ts` refuses without `ROE_PILOT_PROJECT_HARD_LIMIT_USD=40`,
`ROE_PILOT_PROJECT_ISOLATED=yes`, a provider token and a Firstmate reservation.
These two project variables are operator attestations; the runner cannot
independently read the OpenAI billing settings. A provider credential will be
visible to the sandboxed Codex process and to Docker inspect while that
disposable container exists; use only a credential whose limited scope and
lifetime make that exposure acceptable. If a credentialed container fails,
remove that exact container and require prompt key revocation; retain the
private clone as potentially sensitive with the reservation for reconciliation.

The enforced $40 threshold leaves room below André's $50 trial budget but is
not an absolute ceiling. OpenAI says enforcement is not instantaneous and
recorded spend can slightly exceed the configured amount. Verify that hard
enforcement is enabled; a spend alert alone does not block traffic.
https://developers.openai.com/api/docs/guides/spend-limits

No Firstmate task has been registered for this gate. No container, credential,
provider request or model turn has been run. After the project preflight,
review the exact command and volume/network scope, register a new metadata-only
operator-only Firstmate task, recheck `roe-coordination status`, and route the
captured request through the Operator pane under its Firstmate reservation.
On failure retain the exact disposable
resources and reservation for reconciliation. A pass will prove only provider
authentication and one bounded Codex inference turn. Native transcript resume,
container persistence, Herdr restore, Claude/Pi adapters and role activation
remain separate gates. `roe-role run` stays disabled.
