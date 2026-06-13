#!/usr/bin/env node
// One-time: create the agent inbox on the (verified) domain, or list inboxes.
//
//   node setup-inbox.mjs --list
//   node setup-inbox.mjs --username agent --domain rockofeye.net --display "RoE Agent"
//
// Note: creating an inbox on a custom domain requires the domain to be VERIFIED
// in AgentMail. Until then, use the default agentmail.to inbox for testing and
// set it as "inbox" in config/settings.json.

import { parseArgs, fail } from './lib/config.mjs';
import { listInboxes, createInbox } from './lib/agentmail.mjs';

const args = parseArgs();

if (args.list || (!args.username && !args.domain)) {
  const data = await listInboxes();
  const inboxes = Array.isArray(data) ? data : data.inboxes || data.data || [];
  if (!inboxes.length) { console.log('(no inboxes)'); process.exit(0); }
  for (const i of inboxes) {
    console.log(`${i.inbox_id || i.id}\t${i.address || i.email || ''}\t${i.display_name || ''}`);
  }
  console.log('\nSet one as "inbox" in config/settings.json.');
  process.exit(0);
}

if (!args.username || !args.domain) fail('Provide both --username and --domain (or --list).');

const body = { username: args.username, domain: args.domain };
if (args.display) body.display_name = args.display;

const created = await createInbox(body);
console.log('✓ Inbox created:');
console.log(JSON.stringify(created, null, 2));
console.log(`\nSet "inbox": "${args.username}@${args.domain}" in config/settings.json.`);
