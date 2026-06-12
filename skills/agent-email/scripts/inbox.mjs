#!/usr/bin/env node
// Poll the agent inbox (the "receive" half — no webhook needed locally).
//
//   node inbox.mjs                 # list recent messages
//   node inbox.mjs --id <msgId>    # read one message in full

import { parseArgs } from './lib/config.mjs';
import { resolveInboxId, listMessages, getMessage } from './lib/agentmail.mjs';

const args = parseArgs();
const inboxId = await resolveInboxId();

if (args.id) {
  const m = await getMessage(inboxId, args.id);
  console.log(JSON.stringify(m, null, 2));
} else {
  const data = await listMessages(inboxId);
  const msgs = Array.isArray(data) ? data : data.messages || data.data || [];
  if (!msgs.length) {
    console.log('(no messages)');
  } else {
    for (const m of msgs.slice(0, Number(args.limit) || 20)) {
      const id = m.message_id || m.id;
      const from = m.from || (m.from_ && m.from_.address) || '?';
      const subj = m.subject || '(no subject)';
      const when = m.timestamp || m.created_at || m.date || '';
      console.log(`${id}\t${when}\t${from}\t${subj}`);
    }
    console.log(`\nRead one: node inbox.mjs --id <messageId>`);
  }
}
