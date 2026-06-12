---
name: agent-email
description: Send and receive email AS the agent, via AgentMail (agent@rockofeye.net). Use when the user asks to email someone a summary/update/report, to check the agent's inbox, or to reply to a message the agent received. Personal to André; human-in-the-loop only.
---

# Agent Email

Lets the agent send and receive email through a dedicated AgentMail inbox
(`agent@rockofeye.net`). Built for **human-in-the-loop, interactive use only** —
there is no autonomous or scheduled sending.

## Hard rules — do not violate

1. **Allowlist.** The agent may ONLY email addresses in `config/allowlist.json`
   (To, Cc, and replies). The scripts enforce this; never try to work around it.
2. **Always draft → review → send.** Never send without showing the rendered
   draft to the user first.
3. **Never pass `--confirm` to `send.mjs` until the user has explicitly approved
   the rendered draft in the chat.** `--confirm` is the human's decision, not
   yours. No "I'll just send it" — show, wait for an explicit yes, then send.
4. **Secrets are auto-redacted** before you ever see the draft, but still don't
   put credentials, tokens, or `.env` contents into a body.

## Sending (the normal flow)

All scripts are under `scripts/` in this skill. Run with `node`.

1. **Draft it:**
   ```bash
   node scripts/draft.mjs --to "andre@example.com" --subject "Build summary" --body "..."
   ```
   For long/multiline bodies, write the body to a temp file and use
   `--body-file /tmp/body.txt`. Add `--cc` if needed.

   This enforces the allowlist, redacts secrets, appends a provenance footer,
   prints the full rendered email, and saves a draft with an id.

2. **Show the user** the rendered draft (it's printed by `draft.mjs`). Ask them
   to confirm.

3. **After they approve in chat**, send:
   ```bash
   node scripts/send.mjs --draft <id> --confirm
   ```
   Without `--confirm` it refuses and re-prints the draft. Every send is audited
   (local JSONL always; CloudWatch `/roe/agent-email/audit` when available).

## Receiving

- **Check the inbox:**
  ```bash
  node scripts/inbox.mjs            # recent messages: id, date, from, subject
  node scripts/inbox.mjs --id <messageId>   # full message
  ```
- **Reply** (same draft→approve→send flow; the original sender must be on the
  allowlist):
  ```bash
  node scripts/reply.mjs --message <messageId> --body "..."
  # → prints a reply draft id → send with send.mjs --draft <id> --confirm
  ```

## Setup / troubleshooting

- API key: `AGENTMAIL_API_KEY` must be in `/workspace/.env.local` (personal,
  gitignored — NOT the shared `.env.schema`).
- Inbox: `config/settings.json` → `inbox`. `agent@rockofeye.net` needs the
  domain VERIFIED + the inbox created (`node scripts/setup-inbox.mjs`). Before
  that, `node scripts/setup-inbox.mjs --list` and set the default agentmail.to
  inbox for testing.
- Allowlist starts EMPTY (blocks all). Add recipients to
  `config/allowlist.json` before the first send.
- See `README.md` for the full setup and the AWS/DNS side.
