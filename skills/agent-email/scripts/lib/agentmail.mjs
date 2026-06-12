// Thin AgentMail REST client (https://api.agentmail.to/v0), Bearer auth.

import { requireApiKey, settings, fail } from './config.mjs';

const BASE = 'https://api.agentmail.to/v0';

async function api(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireApiKey()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    fail(`AgentMail ${method} ${path} → HTTP ${res.status}\n${JSON.stringify(json, null, 2)}`);
  }
  return json;
}

export const listInboxes = () => api('GET', '/inboxes');
export const createInbox = (body) => api('POST', '/inboxes', body);
export const sendMessage = (inboxId, body) =>
  api('POST', `/inboxes/${encodeURIComponent(inboxId)}/messages/send`, body);
export const listMessages = (inboxId) =>
  api('GET', `/inboxes/${encodeURIComponent(inboxId)}/messages`);
export const getMessage = (inboxId, messageId) =>
  api('GET', `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}`);
export const replyMessage = (inboxId, messageId, body) =>
  api('POST', `/inboxes/${encodeURIComponent(inboxId)}/messages/${encodeURIComponent(messageId)}/reply`, body);

// Resolve the configured inbox to an inbox id AgentMail accepts.
// settings.inbox may be an inbox id or an email address; if it's an address we
// match it against the inbox list. Falls back to the only/first inbox.
export async function resolveInboxId() {
  const want = (settings().inbox || '').toLowerCase();
  const data = await listInboxes();
  const inboxes = Array.isArray(data) ? data : data.inboxes || data.data || [];
  if (!inboxes.length) {
    fail('No AgentMail inboxes exist yet. Create one with: node scripts/setup-inbox.mjs');
  }
  const idOf = (i) => i.inbox_id || i.id;
  const addrOf = (i) => (i.address || i.email || idOf(i) || '').toLowerCase();
  if (want) {
    const hit = inboxes.find((i) => addrOf(i) === want || idOf(i) === settings().inbox);
    if (hit) return idOf(hit);
    fail(`Configured inbox "${settings().inbox}" not found among ${inboxes.length} inbox(es). ` +
      `Available: ${inboxes.map(addrOf).join(', ')}`);
  }
  if (inboxes.length > 1) {
    fail(`Multiple inboxes exist; set "inbox" in config/settings.json. ` +
      `Available: ${inboxes.map(addrOf).join(', ')}`);
  }
  return idOf(inboxes[0]);
}
