// Secret redaction for any content the sandbox emits (logs, audit detail, comms).
// Ported from skills/agent-email/scripts/lib/redact.mjs. Two layers:
//   (1) literal scrub of known secret VALUES from the current environment,
//   (2) pattern scrub for common credential shapes.
//
// Layer (1) reads process.env directly (the substrate is env-configured), so any
// secret present in the setup phase is scrubbed by value even if its shape is unusual.

const PATTERNS = [
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, 'private-key'],
  [/\bAKIA[0-9A-Z]{16}\b/g, 'aws-access-key-id'],
  [/\bASIA[0-9A-Z]{16}\b/g, 'aws-temp-key-id'],
  [/\bBearer\s+[A-Za-z0-9._\-]{16,}\b/gi, 'bearer-token'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'slack-token'],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, 'github-token'],
  [/\bey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, 'jwt'],
  [/\b(?:sk|pk|rk|lin|sntrys?)[-_][A-Za-z0-9]{20,}\b/g, 'api-key'],
];

const SECRET_NAME = /(API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD|CREDENTIAL)$/i;

// Secret-looking values from the current environment, for literal redaction.
function knownSecrets() {
  const out = [];
  for (const [k, v] of Object.entries(process.env)) {
    if (v && v.length >= 8 && SECRET_NAME.test(k)) out.push({ name: k, value: v });
  }
  return out;
}

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns { text, count, hits: [{type, n}] }
export function redact(input) {
  let text = String(input ?? '');
  const hits = {};
  const bump = (type, n) => { if (n) hits[type] = (hits[type] || 0) + n; };

  for (const { name, value } of knownSecrets()) {
    const re = new RegExp(esc(value), 'g');
    const matches = text.match(re);
    if (matches) {
      bump(`env:${name}`, matches.length);
      text = text.replace(re, `[REDACTED:${name}]`);
    }
  }

  for (const [re, type] of PATTERNS) {
    let n = 0;
    text = text.replace(re, () => { n++; return `[REDACTED:${type}]`; });
    bump(type, n);
  }

  const hitList = Object.entries(hits).map(([type, n]) => ({ type, n }));
  const count = hitList.reduce((a, h) => a + h.n, 0);
  return { text, count, hits: hitList };
}

// CLI: pipe content through redaction — `echo "$LOG" | node redact.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (input += c));
  process.stdin.on('end', () => process.stdout.write(redact(input).text));
}
