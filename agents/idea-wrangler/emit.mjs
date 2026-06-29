#!/usr/bin/env node
// Idea Wrangler — emit step. Mails the finished concept to the Linear team intake
// address via AgentMail, so it becomes a Triage issue (subject → title, body →
// description). This is the ONLY external write in the whole run, and it goes to a
// single, fixed, internal address — never anywhere else.
//
//   node emit.mjs --concept /work/out/concept.md --config ./config.json
//
// Reuses the sandbox's redaction + audit (no duplication). Requires AGENTMAIL_API_KEY
// in the env (sourced in the agent phase). Fails loudly if the intake address is still
// a placeholder.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AGENTMAIL_BASE = 'https://api.agentmail.to/v0';
const SANDBOX_DIR = process.env.SANDBOX_DIR || '/opt/sandbox';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
function die(msg) { console.error(`✖ emit: ${msg}`); process.exit(1); }

// Reuse sandbox libs (present in the image at $SANDBOX_DIR/lib).
const { redact } = await import(join(SANDBOX_DIR, 'lib/redact.mjs')).catch(() => ({ redact: (t) => ({ text: t, count: 0 }) }));
const { audit } = await import(join(SANDBOX_DIR, 'lib/audit.mjs')).catch(() => ({ audit: () => ({}) }));

const conceptPath = arg('concept') || die('missing --concept <path>');
const configPath = arg('config') || die('missing --config <path>');

const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
const intake = cfg.linear?.intake_email || '';
const inboxWant = (cfg.agentmail?.inbox || '').toLowerCase();

if (!intake || intake.startsWith('PLACEHOLDER')) {
  die(`linear.intake_email is not set in config.json (got "${intake}").\n` +
      `  Set it to your Linear team intake address (Settings → Team → Intake).`);
}
const apiKey = process.env.AGENTMAIL_API_KEY;
if (!apiKey) die('AGENTMAIL_API_KEY not in env — cannot send.');

// Concept → subject (the H1) + body (redacted).
const raw = readFileSync(conceptPath, 'utf8');
const h1 = raw.split('\n').find((l) => /^#\s+Idea Concept:/i.test(l));
if (!h1) die('concept has no "# Idea Concept: …" H1 — refusing to send a malformed issue.');
const subject = h1.replace(/^#\s+/, '').trim();
const { text: body, count: redactions } = redact(raw);

// AgentMail REST helper (Bearer auth) — mirrors skills/agent-email/lib/agentmail.mjs.
async function am(method, path, payload) {
  const res = await fetch(`${AGENTMAIL_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const txt = await res.text();
  let json; try { json = txt ? JSON.parse(txt) : {}; } catch { json = { raw: txt }; }
  if (!res.ok) die(`AgentMail ${method} ${path} → HTTP ${res.status}\n${JSON.stringify(json)}`);
  return json;
}

// Resolve the sending inbox (the agent's own mailbox).
const data = await am('GET', '/inboxes');
const inboxes = Array.isArray(data) ? data : data.inboxes || data.data || [];
if (!inboxes.length) die('no AgentMail inboxes exist (see skills/agent-email/setup-inbox).');
const idOf = (i) => i.inbox_id || i.id;
const addrOf = (i) => (i.address || i.email || idOf(i) || '').toLowerCase();
const inbox = inboxWant ? inboxes.find((i) => addrOf(i) === inboxWant) : inboxes[0];
if (!inbox) die(`configured inbox "${cfg.agentmail.inbox}" not found among: ${inboxes.map(addrOf).join(', ')}`);

// Send — recipient is HARD-LOCKED to the single intake address. No other recipients.
const result = await am('POST', `/inboxes/${encodeURIComponent(idOf(inbox))}/messages/send`, {
  to: [intake],
  subject,
  text: body,
});
const messageId = result.message_id || result.id || null;

const rec = audit({
  event: 'idea.emit',
  to: intake,
  subject,
  message_id: messageId,
  redactions_applied: redactions,
  concept_path: conceptPath,
});
console.log(`  ✓ emitted to Linear intake (${intake})${messageId ? ` — message ${messageId}` : ''}`);
console.log(`    subject: ${subject}`);
console.log(`    redactions: ${redactions} · audit: local${rec._cw ? ' + CloudWatch' : ''}`);
