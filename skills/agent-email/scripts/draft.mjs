#!/usr/bin/env node
// Compose an email DRAFT: enforce allowlist, redact secrets, render for review.
// Does NOT send. Prints a draft id to pass to send.mjs after human approval.
//
//   node draft.mjs --to a@x.com[,b@y.com] --subject "..." --body "..."
//   node draft.mjs --to a@x.com --subject "..." --body-file /tmp/body.txt [--cc c@z.com]

import { readFileSync } from 'node:fs';
import { parseArgs, fail } from './lib/config.mjs';
import { redact } from './lib/redact.mjs';
import {
  splitAddrs, enforceAllowlist, footer, renderPreview, writeDraft,
} from './lib/compose.mjs';

const args = parseArgs();
const to = splitAddrs(args.to);
const cc = splitAddrs(args.cc);
const subject = args.subject || '';

if (!to.length) fail('Missing --to');
if (!subject) fail('Missing --subject');

let rawBody = args.body || '';
if (args['body-file']) rawBody = readFileSync(args['body-file'], 'utf8');
if (!rawBody) fail('Missing --body or --body-file');

// 1. Allowlist gate (recipients + cc).
enforceAllowlist([...to, ...cc]);

// 2. Redact secrets, then append provenance footer (footer is never redacted).
const { text: redacted, count, hits } = redact(rawBody);
const body = redacted + footer();

// 3. Persist the draft and show it for review.
const { id, path } = writeDraft({
  kind: 'send', to, cc, subject, body,
  redactCount: count, redactHits: hits,
});

console.log(renderPreview({ to, cc, subject, body, redactCount: count }));
if (count) {
  console.log(`\n⚠ ${count} secret-shaped value(s) were redacted: ` +
    hits.map((h) => `${h.type}×${h.n}`).join(', '));
}
console.log(`\nDraft saved: ${id}`);
console.log(`Review the draft above with the user. Once they approve in chat, send with:`);
console.log(`  node ${new URL('./send.mjs', import.meta.url).pathname} --draft ${id} --confirm`);
