#!/usr/bin/env node
// Send a previously-created DRAFT. This is the gated action.
//
//   node send.mjs --draft <id> --confirm
//
// --confirm is REQUIRED. The skill instructs the agent to pass it ONLY after
// the user has explicitly approved the rendered draft in chat. Without it, this
// refuses and re-prints the draft for review.

import { parseArgs, fail } from './lib/config.mjs';
import { readDraft, enforceAllowlist, renderPreview } from './lib/compose.mjs';
import { resolveInboxId, sendMessage, replyMessage } from './lib/agentmail.mjs';
import { audit } from './lib/audit.mjs';

const args = parseArgs();
if (!args.draft) fail('Missing --draft <id>');

const draft = readDraft(args.draft);

// Re-enforce the allowlist at send time (defence in depth — the draft file
// could have been hand-edited).
enforceAllowlist([...(draft.to || []), ...(draft.cc || [])]);

if (!args.confirm) {
  console.log(renderPreview({
    to: draft.to, cc: draft.cc, subject: draft.subject,
    body: draft.body, redactCount: draft.redactCount,
  }));
  fail('Refusing to send without --confirm.\n' +
    'Show this draft to the user; once they approve in chat, re-run with --confirm.');
}

const inboxId = await resolveInboxId();
const payload = {
  to: draft.to,
  ...(draft.cc && draft.cc.length ? { cc: draft.cc } : {}),
  subject: draft.subject,
  text: draft.body,
};

let result;
if (draft.kind === 'reply' && draft.in_reply_to) {
  result = await replyMessage(inboxId, draft.in_reply_to, payload);
} else {
  result = await sendMessage(inboxId, payload);
}

const messageId = result.message_id || result.id || null;
const rec = audit({
  action: draft.kind === 'reply' ? 'reply' : 'send',
  inbox_id: inboxId,
  to: draft.to,
  cc: draft.cc || [],
  subject: draft.subject,
  draft_id: draft.id,
  in_reply_to: draft.in_reply_to || null,
  message_id: messageId,
  confirmed: true,
  redactions_applied: draft.redactCount || 0,
});

console.log(`\n✓ Sent to ${draft.to.join(', ')}` + (messageId ? ` (message ${messageId})` : ''));
console.log(`  audit: local${rec._cw ? ' + CloudWatch' : ' (CloudWatch skipped — group not applied / no AWS)'}`);
