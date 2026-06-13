#!/usr/bin/env node
// Draft a REPLY to a received message. Same guardrails as draft.mjs: the reply
// recipient (original sender) must be on the allowlist, body is redacted, and
// it produces a draft to send.mjs — it does NOT send.
//
//   node reply.mjs --message <msgId> --body "..." [--subject "..."]

import { readFileSync } from 'node:fs';
import { parseArgs, fail } from './lib/config.mjs';
import { redact } from './lib/redact.mjs';
import { enforceAllowlist, extractEmail, footer, renderPreview, writeDraft } from './lib/compose.mjs';
import { resolveInboxId, getMessage } from './lib/agentmail.mjs';

const args = parseArgs();
if (!args.message) fail('Missing --message <msgId>');

let rawBody = args.body || '';
if (args['body-file']) rawBody = readFileSync(args['body-file'], 'utf8');
if (!rawBody) fail('Missing --body or --body-file');

const inboxId = await resolveInboxId();
const original = await getMessage(inboxId, args.message);
const replyTo = extractEmail(original.from || (original.from_ && original.from_.address));
if (!replyTo) fail('Could not determine the original sender to reply to.');

// The agent may only converse with the allowlist — replies included.
enforceAllowlist([replyTo]);

const subject = args.subject ||
  (original.subject ? (/^re:/i.test(original.subject) ? original.subject : `Re: ${original.subject}`) : 'Re:');
const { text: redacted, count, hits } = redact(rawBody);
const body = redacted + footer();

const { id } = writeDraft({
  kind: 'reply', in_reply_to: args.message,
  to: [replyTo], cc: [], subject, body,
  redactCount: count, redactHits: hits,
});

console.log(renderPreview({ to: [replyTo], subject, body, redactCount: count }));
if (count) console.log(`\n⚠ ${count} redaction(s): ` + hits.map((h) => `${h.type}×${h.n}`).join(', '));
console.log(`\nReply draft saved: ${id}`);
console.log(`After the user approves, send with:`);
console.log(`  node ${new URL('./send.mjs', import.meta.url).pathname} --draft ${id} --confirm`);
