// Shared config + env loading for the agent-email skill.
// Zero dependencies — Node 22 native fetch + fs.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SKILL_DIR = resolve(__dirname, '..', '..'); // skills/agent-email
export const LOGS_DIR = join(SKILL_DIR, 'logs');
export const DRAFTS_DIR = join(LOGS_DIR, 'drafts');

const ENV_FILE = process.env.ROE_ENV_FILE || '/workspace/.env.local';

// Parse a dotenv-style file into a plain object (no interpolation).
function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = parseEnvFile(ENV_FILE);

export function env(name) {
  return process.env[name] ?? fileEnv[name] ?? '';
}

export function requireApiKey() {
  const key = env('AGENTMAIL_API_KEY');
  if (!key) {
    fail(`AGENTMAIL_API_KEY not found in process env or ${ENV_FILE}.\n` +
      `Add it to ${ENV_FILE} (personal, gitignored) — not the shared .env.schema.`);
  }
  return key;
}

// All secret-looking values from the env file, for literal redaction.
export function knownSecrets() {
  const out = [];
  const re = /(API_KEY|_KEY|_TOKEN|_SECRET|_PASSWORD|CREDENTIAL)$/i;
  for (const [k, v] of Object.entries(fileEnv)) {
    if (v && v.length >= 8 && re.test(k)) out.push({ name: k, value: v });
  }
  return out;
}

export function loadJson(relPath, fallback) {
  const p = join(SKILL_DIR, relPath);
  if (!existsSync(p)) return fallback;
  return JSON.parse(readFileSync(p, 'utf8'));
}

export function settings() {
  return loadJson('config/settings.json', {});
}

// Allowlist of permitted recipients. EMPTY = block everything (safe default).
export function allowlist() {
  const a = loadJson('config/allowlist.json', { recipients: [] });
  return (a.recipients || [])
    .map((r) => (typeof r === 'string' ? r : r.email))
    .filter(Boolean)
    .map((e) => e.toLowerCase());
}

export function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// Tiny --flag value parser. Supports --flag value and --flag=value and bare --flag.
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        out[a.slice(2, eq)] = a.slice(eq + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        out[a.slice(2)] = argv[++i];
      } else {
        out[a.slice(2)] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}
