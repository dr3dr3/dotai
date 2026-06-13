// Append-only audit of every send. Local JSONL is primary + always written;
// CloudWatch (/roe/agent-email/audit) is best-effort via the AWS CLI (SSO creds)
// and silently skipped if the group doesn't exist yet (TF not applied) or no AWS.

import { execFileSync } from 'node:child_process';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOGS_DIR, settings } from './config.mjs';

const LOCAL_AUDIT = join(LOGS_DIR, 'agent-email.audit.jsonl');

// Resolve who authorised the send, for attribution in the audit trail:
//   1. AWS SSO identity — last path segment of the caller ARN (e.g.
//      .../AWSReservedSSO_AdministratorAccess_xxx/andre.dreyer → "andre.dreyer"),
//      which matches the principal CloudTrail attributes the log write to.
//      Only available while the SSO token is live (~8-12h).
//   2. settings.operator (reliable fallback when the token is stale)
//   3. process.env.USER
//   4. "unknown"
let _actor;
function resolveActor() {
  if (_actor) return _actor;
  const s = settings();
  try {
    const args = ['sts', 'get-caller-identity', '--query', 'Arn', '--output', 'text',
      '--region', s.aws_region || 'ap-southeast-2',
      ...(s.aws_profile ? ['--profile', s.aws_profile] : [])];
    const arn = execFileSync('aws', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const seg = arn.split('/').pop();
    if (seg) return (_actor = seg);
  } catch { /* SSO token stale / no AWS creds — fall through */ }
  return (_actor = s.operator || process.env.USER || 'unknown');
}

export function audit(event) {
  const record = { ts: new Date().toISOString(), actor: resolveActor(), ...event };
  const line = JSON.stringify(record);

  // 1. Local JSONL (primary).
  try {
    mkdirSync(LOGS_DIR, { recursive: true });
    appendFileSync(LOCAL_AUDIT, line + '\n');
  } catch (e) {
    console.error(`⚠ local audit write failed: ${e.message}`);
  }

  // 2. CloudWatch (best-effort).
  const group = settings().audit_log_group || '/roe/agent-email/audit';
  const profile = settings().aws_profile;
  const region = settings().aws_region || 'ap-southeast-2';
  try {
    const stream = record.ts.slice(0, 10); // one stream per day
    const base = ['logs', '--region', region, ...(profile ? ['--profile', profile] : [])];
    // Create stream if missing (ignore "already exists").
    try {
      execFileSync('aws', [...base, 'create-log-stream',
        '--log-group-name', group, '--log-stream-name', stream],
        { stdio: 'ignore' });
    } catch { /* exists or group absent — putLogEvents below decides */ }
    execFileSync('aws', [...base, 'put-log-events',
      '--log-group-name', group, '--log-stream-name', stream,
      '--log-events', JSON.stringify([{ timestamp: Date.now(), message: line }])],
      { stdio: 'ignore' });
    record._cw = true;
  } catch {
    // Group not applied yet / no AWS creds — local JSONL still has it.
    record._cw = false;
  }
  return record;
}
