/**
 * Evidence and the slot model behind the Datafaced timesheet.
 *
 * Evidence is one timestamp per event: a prompt André typed into Claude Code, a commit or
 * PR/issue he authored in the org, or a calendar meeting. The slot model, agreed 2026-10-04,
 * is deliberately conservative: a 30-minute slot is billed when it holds evidence, or sits in a
 * gap of <= gapFill minutes between two billed slots. No lead-in before a session's first event.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';

export const SLOT_MS = 30 * 60_000;
const DAY_MS = 24 * 3_600_000;

function expand(p: string): string {
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

export function paths() {
  const home = expand(
    process.env.TIMESHEET_HOME ?? (existsSync(join(homedir(), '.ai')) ? '~/.ai/timesheet' : '~/.local/share/timesheet'),
  );
  return {
    home,
    ledger: join(home, 'claude-prompts.jsonl'),
    sessions: join(home, 'claude-sessions.json'),
    cache: join(home, 'cache'),
    transcripts: expand(process.env.CLAUDE_PROJECTS ?? '~/.claude/projects'),
  };
}

export function fail(message: string): never {
  throw new Error(message);
}

// ── time ────────────────────────────────────────────────────────────────────

const formats = new Map<string, Intl.DateTimeFormat>();

function localParts(ms: number, tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formats.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, H: +p.hour, M: +p.minute };
}

export function localDate(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

export function localTime(ms: number, tz: string): string {
  const p = localParts(ms, tz);
  return `${String(p.H).padStart(2, '0')}:${String(p.M).padStart(2, '0')}`;
}

function offsetMs(ms: number, tz: string): number {
  const p = localParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.H, p.M) - Math.floor(ms / 60_000) * 60_000;
}

/** The instant local midnight starts on y-m-d in tz. */
export function zonedMidnight(y: number, m: number, d: number, tz: string): number {
  const wall = Date.UTC(y, m - 1, d);
  let t = wall;
  for (let i = 0; i < 3; i++) t = wall - offsetMs(t, tz);
  return t;
}

export function monthBounds(month: string, tz: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(month) ?? fail(`month must be YYYY-MM, got ${month}`);
  const y = +match[1];
  const m = +match[2];
  const start = zonedMidnight(y, m, 1, tz);
  const end = zonedMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1, tz);
  // Slots are floored on epoch half-hours, which are local half-hours only when the zone's
  // offset is a whole number of half-hours (true for Brisbane, Sydney, Adelaide; not Nepal).
  if (offsetMs(start, tz) % SLOT_MS) fail(`${tz} is not offset by whole half-hours; slots would not align`);
  const days: string[] = [];
  for (let t = start; t < end; t = zonedMidnight(...nextDay(localDate(t, tz)), tz)) days.push(localDate(t, tz));
  return { start, end, days };
}

function nextDay(date: string): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d) + DAY_MS);
  return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()];
}

export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export function parseTs(s: string): number {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) fail(`timestamp without a timezone: ${s}`);
  const t = Date.parse(s);
  if (Number.isNaN(t)) fail(`unparseable timestamp: ${s}`);
  return t;
}

// ── Claude evidence ─────────────────────────────────────────────────────────

export type Prompt = { uuid: string; ts: string; project: string; session?: string; branch?: string };

function* jsonlFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* jsonlFiles(p);
    else if (name.endsWith('.jsonl')) yield p;
  }
}

/**
 * Every prompt a human typed into Claude Code, plus each session's auto-generated title.
 * Excluded: Firstmate crew worktrees and launch briefs, bypassPermissions sessions (agents),
 * sub-agents, and meta/injected messages (<task-notification>, <command-name>, hook output).
 */
export function readTranscripts(root = paths().transcripts) {
  const prompts: Prompt[] = [];
  const titles: Record<string, string> = {};
  for (const f of jsonlFiles(root)) {
    const project = relative(root, f).split(sep)[0];
    if (project.includes('--treehouse-')) continue;
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.includes('"ai-title"')) {
        try {
          const d = JSON.parse(line);
          if (d.type === 'ai-title' && d.sessionId && d.aiTitle) titles[d.sessionId] = d.aiTitle;
        } catch {
          /* a torn last line */
        }
        continue;
      }
      if (!line.includes('"human"')) continue;
      let d;
      try {
        d = JSON.parse(line);
      } catch {
        continue;
      }
      if (d.type !== 'user' || d.isSidechain || d.isMeta) continue;
      if (d.origin?.kind !== 'human' || d.permissionMode === 'bypassPermissions') continue;
      let c = d.message?.content;
      if (Array.isArray(c))
        c = c
          .filter((b) => b && typeof b === 'object' && b.type === 'text')
          .map((b) => b.text ?? '')
          .join(' ');
      const t = String(c ?? '').trim();
      if (!t || t.startsWith('<') || t.includes('FIRSTMATE_OP')) continue;
      prompts.push({ uuid: d.uuid, ts: d.timestamp, project, session: d.sessionId, branch: d.gitBranch || undefined });
    }
  }
  return { prompts, titles };
}

export function readLedger(file = paths().ledger): Map<string, Prompt> {
  const rows = new Map<string, Prompt>();
  if (!existsSync(file)) return rows;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Prompt;
      if (r.uuid) rows.set(r.uuid, r);
    } catch {
      /* skip a torn line */
    }
  }
  return rows;
}

export function readSessions(file = paths().sessions): Record<string, string> {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/**
 * Merge live transcripts into the ledger (the SessionStart hook). Keeps uuid, timestamp,
 * project, session id and git branch — never prompt text — plus each session's
 * auto-generated title, because transcripts are pruned and the ledger is what bills.
 */
export function archive(): { added: number; total: number } {
  const p = paths();
  mkdirSync(p.home, { recursive: true });
  const rows = readLedger(p.ledger);
  const before = rows.size;
  const { prompts, titles } = readTranscripts(p.transcripts);
  let backfilled = false;
  for (const pr of prompts) {
    const old = rows.get(pr.uuid);
    if (!old) rows.set(pr.uuid, pr);
    else if ((!old.session && pr.session) || (!old.branch && pr.branch)) {
      rows.set(pr.uuid, { ...old, session: old.session ?? pr.session, branch: old.branch ?? pr.branch });
      backfilled = true;
    }
  }
  if (rows.size !== before || backfilled) {
    const sorted = [...rows.values()].sort((a, b) => a.ts.localeCompare(b.ts));
    writeFileSync(p.ledger, sorted.map((r) => JSON.stringify(r)).join('\n') + '\n');
  }
  const sessions = { ...readSessions(p.sessions), ...titles };
  writeFileSync(p.sessions, JSON.stringify(sessions, null, 1) + '\n');
  return { added: rows.size - before, total: rows.size };
}

// ── GitHub evidence ─────────────────────────────────────────────────────────

const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** GitHub search, every page. The search API allows 30 requests/min and 1000 results/query. */
export function ghSearch<T>(kind: 'commits' | 'issues', q: string): T[] {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const r = spawnSync(
      'gh',
      ['api', '-X', 'GET', `search/${kind}`, '-f', `q=${q}`, '-f', 'per_page=100', '-f', `page=${page}`],
      { encoding: 'utf8', maxBuffer: 64 << 20 },
    );
    if (r.status !== 0) fail(`gh search failed (${q}): ${(r.stderr || r.error?.message || '').trim()}`);
    const body = JSON.parse(r.stdout);
    if (body.incomplete_results) console.error(`warning: GitHub marked results incomplete for ${JSON.stringify(q)}`);
    out.push(...body.items);
    sleepMs(2200);
    if (body.items.length < 100) return out;
    if (page === 10) fail(`more than 1000 results for ${JSON.stringify(q)}; the search API cannot page past that`);
  }
}

export type Ev = { t: number; src: 'claude' | 'commit' | 'pr'; text: string; key?: string };
type GhRow = [string, 'commit' | 'pr', string];

function utcDays(start: number, end: number): string[] {
  const days: string[] = []; // search dates are UTC; pad both ends of the local month
  for (let t = start - DAY_MS; t <= end; t += DAY_MS) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

/** One query per day per kind: a busy month exceeds the search API's 1000-result cap. */
function fetchGithub(start: number, end: number, user: string, org: string): GhRow[] {
  const rows: GhRow[] = [];
  for (const day of utcDays(start, end)) {
    for (const i of ghSearch<any>('commits', `author:${user} org:${org} author-date:${day}`))
      rows.push([i.commit.author.date, 'commit', `${i.repository.full_name}: ${i.commit.message.split('\n')[0]}`]);
    for (const i of ghSearch<any>('issues', `author:${user} org:${org} created:${day}`))
      rows.push([i.created_at, 'pr', `${i.repository_url.split('/').slice(-2).join('/')}: ${i.title}`]);
  }
  return rows;
}

/** Cached per month once the month is over; a month in progress is always re-fetched. */
export function loadGithub(
  month: string,
  start: number,
  end: number,
  o: { user: string; org: string; refresh?: boolean },
): Ev[] {
  const cache = join(paths().cache, `github-${o.user}-${o.org}-${month}.json`);
  let raw: GhRow[];
  if (existsSync(cache) && !o.refresh) raw = JSON.parse(readFileSync(cache, 'utf8'));
  else {
    raw = fetchGithub(start, end, o.user, o.org);
    if (end <= Date.now()) {
      mkdirSync(dirname(cache), { recursive: true });
      writeFileSync(cache, JSON.stringify(raw));
    }
  }
  return raw
    .map(([ts, src, text]) => ({ t: parseTs(ts), src, text }))
    .filter((e) => e.t >= start && e.t < end && e.text.startsWith(o.org + '/'));
}

export function claudeEvents(start: number, end: number): (Ev & { prompt: Prompt })[] {
  const rows = readLedger();
  for (const pr of readTranscripts().prompts) if (!rows.has(pr.uuid)) rows.set(pr.uuid, pr);
  return [...rows.values()]
    .map((prompt) => ({ t: parseTs(prompt.ts), src: 'claude' as const, text: '', prompt }))
    .filter((e) => e.t >= start && e.t < end);
}

export type Meeting = { start: number; end: number; title: string };

/** [{"start": iso, "end": iso, "title": str}, ...] — all-day events should be left out. */
export function loadMeetings(file: string | undefined, start: number, end: number): Meeting[] {
  if (!file) return [];
  return (JSON.parse(readFileSync(file, 'utf8')) as { start: string; end: string; title?: string }[])
    .map((m) => ({ start: parseTs(m.start), end: parseTs(m.end), title: m.title ?? '' }))
    .filter((m) => m.end > start && m.start < end);
}

// ── slot model ──────────────────────────────────────────────────────────────

export const floorSlot = (t: number) => Math.floor(t / SLOT_MS) * SLOT_MS;

/** Returns the set of billed slot starts (epoch ms). */
export function billSlots(points: number[], intervals: [number, number][], gapFill: number): Set<number> {
  const slots = new Set(points.map(floorSlot));
  for (const [s, e] of intervals) for (let k = floorSlot(s); k < e; k += SLOT_MS) slots.add(k);
  const active = [...slots].sort((a, b) => a - b);
  for (let i = 1; i < active.length; i++) {
    const prev = active[i - 1];
    const next = active[i];
    if (next - prev - SLOT_MS <= gapFill * 60_000) for (let k = prev + SLOT_MS; k < next; k += SLOT_MS) slots.add(k);
  }
  return slots;
}
