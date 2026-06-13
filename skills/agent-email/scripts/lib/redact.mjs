// Secret redaction — runs over every outbound body BEFORE the human sees the
// draft. Two layers: (1) literal scrub of known secret values from .env.local,
// (2) pattern scrub for common credential shapes.

import { knownSecrets } from './config.mjs';

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

// Escape a literal string for use in a RegExp.
function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns { text, count, hits: [{type, n}] }
export function redact(input) {
  let text = String(input ?? '');
  const hits = {};
  const bump = (type, n) => { if (n) hits[type] = (hits[type] || 0) + n; };

  // 1. Literal scrub of known secret values (strongest guarantee).
  for (const { name, value } of knownSecrets()) {
    const re = new RegExp(esc(value), 'g');
    const matches = text.match(re);
    if (matches) {
      bump(`env:${name}`, matches.length);
      text = text.replace(re, `[REDACTED:${name}]`);
    }
  }

  // 2. Pattern scrub.
  for (const [re, type] of PATTERNS) {
    let n = 0;
    text = text.replace(re, () => { n++; return `[REDACTED:${type}]`; });
    bump(type, n);
  }

  const hitList = Object.entries(hits).map(([type, n]) => ({ type, n }));
  const count = hitList.reduce((a, h) => a + h.n, 0);
  return { text, count, hits: hitList };
}
