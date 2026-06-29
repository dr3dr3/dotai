// Sandbox-wide audit — append-only JSONL (primary) + best-effort CloudWatch.
// Ported from skills/agent-email/scripts/lib/audit.mjs, adapted to read config from
// the environment (the substrate is configured by env vars, not a settings file).
//
// Usage:
//   import { audit } from './audit.mjs';
//   audit({ event: 'setup.start', profile: process.env.SANDBOX_PROFILE });
//
// Config (all from env):
//   SANDBOX_AUDIT_GROUP   CloudWatch log group           (default /roe/sandbox/audit)
//   SANDBOX_AUDIT_FILE    local JSONL path               (default /var/log/sandbox/audit.jsonl)
//   SANDBOX_OPERATOR      who launched this run          (attribution fallback)
//   SANDBOX_RUN_ID        unique id for this sandbox run (correlates all records)
//   AWS_REGION            region for CloudWatch          (default ap-southeast-2)

import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const REGION = process.env.AWS_REGION || 'ap-southeast-2';
const GROUP = process.env.SANDBOX_AUDIT_GROUP || '/roe/sandbox/audit';
const LOCAL = process.env.SANDBOX_AUDIT_FILE || '/var/log/sandbox/audit.jsonl';
const RUN_ID = process.env.SANDBOX_RUN_ID || 'unknown';

// Resolve who is accountable for this run, for the audit trail:
//   1. SANDBOX_OPERATOR — set explicitly by the launcher (deploy/run.sh passes the
//      human who kicked off a Fargate run; on Fargate STS only yields a role ARN).
//   2. AWS STS caller identity — last ARN segment (matches CloudTrail principal).
//   3. process.env.USER  4. "unknown"
let _actor;
function resolveActor() {
  if (_actor) return _actor;
  if (process.env.SANDBOX_OPERATOR) return (_actor = process.env.SANDBOX_OPERATOR);
  try {
    const arn = execFileSync(
      'aws',
      ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text', '--region', REGION],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const seg = arn.split('/').pop();
    if (seg) return (_actor = seg);
  } catch { /* no AWS creds / stale token — fall through */ }
  return (_actor = process.env.USER || 'unknown');
}

export function audit(event) {
  const record = {
    ts: new Date().toISOString(),
    run_id: RUN_ID,
    actor: resolveActor(),
    profile: process.env.SANDBOX_PROFILE || null,
    env: process.env.SANDBOX_ENV || null,
    ...event,
  };
  const line = JSON.stringify(record);

  // 1. Local JSONL (primary — always written).
  try {
    mkdirSync(dirname(LOCAL), { recursive: true });
    appendFileSync(LOCAL, line + '\n');
  } catch (e) {
    console.error(`⚠ local audit write failed: ${e.message}`);
  }

  // 2. CloudWatch (best-effort — skipped silently if the group/creds aren't there).
  try {
    const stream = `${RUN_ID}/${record.ts.slice(0, 10)}`; // one stream per run per day
    const base = ['logs', '--region', REGION];
    try {
      execFileSync('aws', [...base, 'create-log-stream',
        '--log-group-name', GROUP, '--log-stream-name', stream], { stdio: 'ignore' });
    } catch { /* exists or group absent — put-log-events below decides */ }
    execFileSync('aws', [...base, 'put-log-events',
      '--log-group-name', GROUP, '--log-stream-name', stream,
      '--log-events', JSON.stringify([{ timestamp: Date.now(), message: line }])],
      { stdio: 'ignore' });
    record._cw = true;
  } catch {
    record._cw = false;
  }
  return record;
}

// CLI: `node audit.mjs <event> [k=v ...]` — lets shell phase scripts emit audit lines.
//   node lib/audit.mjs setup.start repos=3
if (import.meta.url === `file://${process.argv[1]}`) {
  const [event, ...pairs] = process.argv.slice(2);
  if (!event) { console.error('usage: node audit.mjs <event> [k=v ...]'); process.exit(1); }
  const extra = {};
  for (const p of pairs) { const i = p.indexOf('='); if (i > 0) extra[p.slice(0, i)] = p.slice(i + 1); }
  const rec = audit({ event, ...extra });
  console.log(`audit: ${rec.event} (cw=${rec._cw})`);
}
