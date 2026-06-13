# agent-email

A personal skill that lets AI agents send and receive email **as the agent**,
through a dedicated [AgentMail](https://agentmail.to) inbox on
`agent@rockofeye.net`. Human-in-the-loop, interactive only — no autonomous or
scheduled sending.

Personal to André: lives in `dotai`, never in the shared `ai-devex`, so other
developers don't get it.

## Architecture

```
draft.mjs ──▶ allowlist gate ──▶ redact secrets ──▶ render + save draft
                                                        │
                                  (human reviews in chat, approves)
                                                        ▼
send.mjs --confirm ──▶ re-check allowlist ──▶ AgentMail send ──▶ audit
```

Three layers:
- **This skill** (`scripts/`, `config/`) — drafting, allowlist, redaction, audit.
- **AgentMail** (external SaaS, SES-backed) — the actual inbox / send / receive.
- **AWS** — DNS for `rockofeye.net` and the CloudWatch audit log group, both in
  the `infrastructure` repo (`env-management/platform-layer/{route53-rockofeye,agent-email-audit}`).

## Guardrails

| Guardrail | Where |
|-----------|-------|
| Recipient **allowlist** (To/Cc/replies) | `config/allowlist.json`, enforced in `lib/compose.mjs` at draft **and** send |
| **Draft → review → send** split | `draft.mjs` / `reply.mjs` never send; `send.mjs` needs `--confirm` |
| `--confirm` only after explicit human OK | enforced by `send.mjs`; instructed in `SKILL.md` |
| **Secret redaction** | `lib/redact.mjs` — literal scrub of `.env.local` values + credential patterns |
| **Audit** (metadata only) | `lib/audit.mjs` — local JSONL + best-effort CloudWatch |

## Setup

1. **API key** — add to `/workspace/.env.local` (personal, gitignored):
   ```
   AGENTMAIL_API_KEY=...
   ```
2. **Allowlist** — add André + the Founder to `config/allowlist.json`:
   ```json
   { "recipients": [
     { "name": "André", "email": "andre@..." },
     { "name": "Founder", "email": "founder@..." }
   ] }
   ```
3. **Inbox** — once `rockofeye.net` is verified in AgentMail:
   ```bash
   node scripts/setup-inbox.mjs --username agent --domain rockofeye.net --display "RoE Agent"
   ```
   Then set `"inbox": "agent@rockofeye.net"` in `config/settings.json`.
   To test before the domain verifies, `node scripts/setup-inbox.mjs --list` and
   use the default `agentmail.to` inbox.
4. **AWS audit (optional)** — once the `agent-email-audit` TF stack is applied,
   set `aws_profile` in `config/settings.json` to a Management SSO profile that
   can write `/roe/agent-email/audit`. Until then, audit is local-only.

## Usage

See `SKILL.md`. Quick reference:
```bash
node scripts/draft.mjs --to "x@y.com" --subject "..." --body "..."
node scripts/send.mjs  --draft <id> --confirm     # after human approval
node scripts/inbox.mjs                            # check inbox
node scripts/reply.mjs --message <id> --body "..."
```

## Requirements

Node 18+ (uses native `fetch`; built on Node 22). No npm dependencies. The
AWS CLI is used for the optional CloudWatch audit.
