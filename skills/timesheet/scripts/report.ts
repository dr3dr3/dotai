/**
 * The month in two numbers Mark can read: where the billed hours went (by Linear project), and
 * how many PRs each developer opened.
 *
 * Hours by area: every billed slot's half hour is shared among the evidence inside it. A bridged
 * slot (no evidence of its own) takes the average of its nearest evidenced neighbours. Each day is
 * then scaled to the hours actually billed, so the areas add up to the invoice.
 *
 * An item's area comes from, in order: a ticket in its PR/commit title or its Claude session's git
 * branch → that ticket's Linear project; else an assignment the AI made from the fixed list of
 * Linear projects (never a category it invented); else "Unassigned".
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  SLOT_MS,
  fail,
  floorSlot,
  ghSearch,
  localDate,
  monthBounds,
  parseTs,
  paths,
  readSessions,
} from './evidence.ts';
import { build, tickets, type Built, type Options } from './draft.ts';
import { harvestEntries } from './harvest.ts';

export const MEETINGS = 'Meetings';
export const UNASSIGNED = 'Unassigned';
export const MANUAL = 'Manual entries (no evidence)';
const TOP = 10;

// ── Linear ──────────────────────────────────────────────────────────────────

function linear(query: string, variables: object = {}): any {
  // `linear api` authenticates itself, so no token passes through this process
  const r = spawnSync('linear', ['api', query, '--variables-json', JSON.stringify(variables)], {
    encoding: 'utf8',
    maxBuffer: 64 << 20,
  });
  if (r.status !== 0) fail(`linear api failed: ${(r.stderr || r.error?.message || '').trim()}`);
  const body = JSON.parse(r.stdout);
  if (body.errors) fail(`linear api: ${JSON.stringify(body.errors).slice(0, 400)}`);
  return body.data;
}

/** Linear projects an area can be — everything except cancelled projects. */
export function linearProjects(): string[] {
  const nodes: { name: string; state: string }[] = linear('{ projects(first: 250) { nodes { name state } } }').projects
    .nodes;
  return nodes
    .filter((p) => p.state !== 'canceled')
    .map((p) => p.name)
    .sort();
}

export type Ticket = { project: string | null; title: string; labels: string[] } | null;

/** ticket id → its Linear project, title and labels (null if not found), cached. */
export function ticketInfo(ids: string[], refresh = false): Record<string, Ticket> {
  const file = join(paths().cache, 'linear-tickets-v2.json');
  const known: Record<string, Ticket> = existsSync(file) && !refresh ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const missing = [...new Set(ids)].filter((id) => !(id in known));
  const byTeam = new Map<string, number[]>();
  for (const id of missing) {
    const [team, n] = id.split('-');
    byTeam.set(team, [...(byTeam.get(team) ?? []), +n]);
  }
  const query = `query($t: String!, $n: [Float!]) { issues(first: 100, filter: { team: { key: { eq: $t } }, number: { in: $n } }) { nodes { identifier title project { name } labels { nodes { name } } } } }`;
  for (const [team, nums] of byTeam)
    for (let i = 0; i < nums.length; i += 100) {
      const chunk = nums.slice(i, i + 100);
      for (const n of chunk) known[`${team}-${n}`] = null; // not found stays null, so it is not re-asked
      for (const node of linear(query, { t: team, n: chunk }).issues.nodes)
        known[node.identifier] = {
          project: node.project?.name ?? null,
          title: node.title,
          labels: node.labels.nodes.map((l: { name: string }) => l.name),
        };
    }
  if (missing.length) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(known, null, 1) + '\n');
  }
  return known;
}

// ── items and attribution ───────────────────────────────────────────────────

export type Item = { key: string; label: string; tickets: string[]; repo?: string };

/**
 * A Claude session takes no ticket from its git branch: the branch belongs to the checkout, and
 * the shared /workspace checkout sits on whatever branch another session left it on. The branch
 * goes into the label as a hint for whoever assigns the session.
 */
export function itemOf(e: Built['events'][number], titles: Record<string, string>): Item {
  if (e.src !== 'claude' || !e.prompt)
    return {
      key: `${e.src}:${e.text}`,
      label: e.text,
      tickets: tickets(e.text),
      repo: e.text.split(':')[0].split('/')[1],
    };
  const p = e.prompt;
  const branch = p.branch && !['main', 'master', 'HEAD'].includes(p.branch) ? p.branch : '';
  const title = p.session ? titles[p.session] : undefined;
  const where = `${p.project.replace(/^-workspace-?/, '') || 'workspace'}${branch ? ` @ ${branch}` : ''}`;
  return {
    key: `session:${p.session ?? `${p.project}:${p.ts.slice(0, 10)}`}`,
    label: `Claude session: ${title ?? '(untitled)'} [checkout: ${where}]`,
    tickets: [],
  };
}

/**
 * What to assign when an item has no Linear project: its ticket (all of that ticket's commits and
 * PRs at once), else the item itself. A `repo:<name>` assignment covers a repo's unticketed items.
 */
export function decisionKey(item: Item, info: Record<string, Ticket>): string {
  const t = item.tickets.find((id) => info[id]);
  return t ? `ticket:${t}` : item.key;
}

type Weights = Map<string, number>;

function add(w: Weights, k: string, v: number) {
  w.set(k, (w.get(k) ?? 0) + v);
}

function normalised(w: Weights, total: number): Weights {
  const sum = [...w.values()].reduce((a, b) => a + b, 0);
  return new Map([...w].map(([k, v]) => [k, (v / sum) * total]));
}

/** Hours per item key for each day, before any day-level scaling. */
export function attribute(built: Built, items: Map<number, Item>, tz: string): Map<string, Weights> {
  const slots = [...built.slots].sort((a, b) => a - b);
  const evidence = new Map<number, Weights>();
  built.events.forEach((e, i) => {
    const s = floorSlot(e.t);
    if (!evidence.has(s)) evidence.set(s, new Map());
    add(evidence.get(s)!, items.get(i)!.key, 1);
  });
  for (const m of built.meetings)
    for (let s = floorSlot(m.start); s < m.end; s += SLOT_MS) {
      if (!evidence.has(s)) evidence.set(s, new Map());
      add(evidence.get(s)!, 'meeting', 1);
    }
  const byDay = new Map<string, Weights>();
  slots.forEach((s, i) => {
    let w = evidence.get(s);
    if (!w) {
      // a bridged slot: average its nearest evidenced neighbours in the same contiguous run
      const mix: Weights = new Map();
      for (const dir of [-1, 1]) {
        for (let j = i + dir; j >= 0 && j < slots.length && Math.abs(slots[j] - slots[j - dir]) === SLOT_MS; j += dir) {
          const n = evidence.get(slots[j]);
          if (n) {
            for (const [k, v] of normalised(n, 1)) add(mix, k, v);
            break;
          }
        }
      }
      w = mix;
    }
    if (!w.size) return;
    const day = localDate(s, tz);
    if (!byDay.has(day)) byDay.set(day, new Map());
    for (const [k, v] of normalised(w, 0.5)) add(byDay.get(day)!, k, v);
  });
  return byDay;
}

export type AreaRow = { area: string; hours: number; pct: number };

/** The roadmap's own grouping, read from the Linear project prefix: P product, T platform, S supply. */
export function themeOf(area: string): string {
  if (/^P\d/.test(area)) return 'Product';
  if (/^T\d/.test(area)) return 'Platform & engineering';
  if (/^S\d/.test(area)) return 'Supply chain';
  if (/^Onboard\b|^Customer Onboarding$/.test(area)) return 'Tenant onboarding';
  return area;
}
export type Areas = {
  total: number;
  rows: AreaRow[];
  all: AreaRow[];
  themes: AreaRow[];
  unassigned: { key: string; label: string; hours: number; repo?: string }[];
  allowed: string[];
};

export function summarise(
  perDay: Map<string, Weights>,
  dayHours: Map<string, number>,
  areaOf: (key: string) => string,
  decision: (key: string) => { key: string; label: string; repo?: string },
  allowed: string[],
): Areas {
  const areas: Weights = new Map();
  const unassigned: Weights = new Map();
  const described = new Map<string, { key: string; label: string; repo?: string }>();
  let total = 0;
  for (const [day, hours] of dayHours) {
    if (!hours) continue;
    total += hours;
    const w = perDay.get(day);
    if (!w?.size) {
      add(areas, MANUAL, hours);
      continue;
    }
    for (const [key, v] of normalised(w, hours)) {
      const area = areaOf(key);
      add(areas, area, v);
      if (area === UNASSIGNED) {
        const d = decision(key);
        add(unassigned, d.key, v);
        described.set(d.key, d);
      }
    }
  }
  const all = [...areas]
    .map(([area, hours]) => ({ area, hours, pct: total ? (hours / total) * 100 : 0 }))
    .sort((a, b) => b.hours - a.hours);
  let rows = all;
  if (all.length > TOP) {
    const rest = all.slice(TOP - 1);
    const hours = rest.reduce((n, r) => n + r.hours, 0);
    rows = [...all.slice(0, TOP - 1), { area: `Other (${rest.length} areas)`, hours, pct: (hours / total) * 100 }];
  }
  const byTheme: Weights = new Map();
  for (const r of all) add(byTheme, themeOf(r.area), r.hours);
  const themes = [...byTheme]
    .map(([area, hours]) => ({ area, hours, pct: total ? (hours / total) * 100 : 0 }))
    .sort((a, b) => b.hours - a.hours);
  return {
    total,
    rows,
    all,
    themes,
    unassigned: [...unassigned]
      .map(([key, hours]) => ({ ...described.get(key)!, hours }))
      .sort((a, b) => b.hours - a.hours),
    allowed,
  };
}

export async function areas(o: Options & { assignments?: string; fromHarvest?: boolean; refreshLinear?: boolean }) {
  const built = build(o);
  const titles = readSessions();
  const items = new Map<number, Item>();
  built.events.forEach((e, i) => items.set(i, itemOf(e, titles)));
  const info = ticketInfo(
    [...items.values()].flatMap((i) => i.tickets),
    o.refreshLinear,
  );
  const allowed = [...linearProjects(), MEETINGS];
  const file = o.assignments ?? join(paths().home, `areas-${o.month}.json`);
  const assigned: Record<string, string> = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const bad = Object.entries(assigned).filter(([, a]) => !allowed.includes(a));
  if (bad.length)
    fail(`${file}: ${bad.length} assignment(s) outside the Linear project list, e.g. ${JSON.stringify(bad[0])}`);
  const byKey = new Map([...items.values()].map((i) => [i.key, i]));
  // Order: a ticket's Linear project, then the AI's assignment of that ticket, of the item
  // itself, then of the item's repo.
  const areaOf = (key: string): string => {
    if (key === 'meeting') return MEETINGS;
    const it = byKey.get(key);
    if (!it) return UNASSIGNED;
    for (const t of it.tickets) if (info[t]?.project) return info[t]!.project!;
    const dk = decisionKey(it, info);
    return (
      assigned[dk] ??
      assigned[it.key] ??
      (it.repo && !it.tickets.length ? assigned[`repo:${it.repo}`] : undefined) ??
      UNASSIGNED
    );
  };
  const decision = (key: string) => {
    const it = byKey.get(key)!;
    const dk = decisionKey(it, info);
    if (dk.startsWith('ticket:')) {
      const id = dk.slice(7);
      const t = info[id]!;
      return {
        key: dk,
        label: `${id}: ${t.title}${t.labels.length ? ` [${t.labels.join(', ')}]` : ''}`,
        repo: it.repo,
      };
    }
    return { key: dk, label: it.label, repo: it.repo };
  };

  const dayHours = new Map(built.draft.days.map((d) => [d.date, d.hours]));
  let source = 'this draft';
  if (o.fromHarvest) {
    // bill what is actually on the invoice, manual days included
    const entries = await harvestEntries(built.draft.days[0].date, built.draft.days.at(-1)!.date);
    for (const d of dayHours.keys()) dayHours.set(d, 0);
    for (const e of entries) dayHours.set(e.date, (dayHours.get(e.date) ?? 0) + e.hours);
    source = 'Harvest';
  }
  return { built, source, file, ...summarise(attribute(built, items, o.tz), dayHours, areaOf, decision, allowed) };
}

// ── PRs by developer ────────────────────────────────────────────────────────

type PrRow = {
  created: string;
  author: string;
  bot: boolean;
  state: string;
  merged: boolean;
  repo: string;
  crew: boolean;
};
export type Dev = {
  author: string;
  opened: number;
  merged: number;
  closed: number;
  open: number;
  repos: number;
  crew: number;
};

/** Firstmate crew PRs say so in their body; nothing else reliably marks an agent-opened PR. */
const CREW = /firstmate|crewmate/i;

export function prsByDeveloper(month: string, tz: string, org: string, refresh = false) {
  const { start, end } = monthBounds(month, tz);
  const cache = join(paths().cache, `prs-${org}-${month}.json`);
  let rows: PrRow[];
  if (existsSync(cache) && !refresh) rows = JSON.parse(readFileSync(cache, 'utf8'));
  else {
    rows = [];
    // weekly windows keep each query under the 1000-result cap; pad a day for UTC vs local
    for (let t = start - 86_400_000; t < end + 86_400_000; t += 7 * 86_400_000) {
      const a = new Date(t).toISOString().slice(0, 10);
      const b = new Date(Math.min(t + 6 * 86_400_000, end + 86_400_000)).toISOString().slice(0, 10);
      for (const i of ghSearch<any>('issues', `is:pr org:${org} created:${a}..${b}`))
        rows.push({
          created: i.created_at,
          author: i.user.login,
          bot: i.user.type === 'Bot',
          state: i.state,
          merged: Boolean(i.pull_request?.merged_at),
          repo: i.repository_url.split('/').at(-1),
          crew: CREW.test(i.body ?? ''),
        });
    }
    const seen = new Set<string>();
    rows = rows.filter((r) => {
      const k = `${r.repo}:${r.created}:${r.author}`;
      return !seen.has(k) && (seen.add(k), true);
    });
    if (end <= Date.now()) {
      mkdirSync(dirname(cache), { recursive: true });
      writeFileSync(cache, JSON.stringify(rows));
    }
  }
  rows = rows.filter((r) => parseTs(r.created) >= start && parseTs(r.created) < end);
  const tally = (bot: boolean): Dev[] => {
    const by = new Map<string, PrRow[]>();
    for (const r of rows.filter((r) => r.bot === bot)) by.set(r.author, [...(by.get(r.author) ?? []), r]);
    return [...by]
      .map(([author, rs]) => ({
        author,
        opened: rs.length,
        merged: rs.filter((r) => r.merged).length,
        closed: rs.filter((r) => r.state === 'closed' && !r.merged).length,
        open: rs.filter((r) => r.state === 'open').length,
        repos: new Set(rs.map((r) => r.repo)).size,
        crew: rs.filter((r) => r.crew).length,
      }))
      .sort((a, b) => b.opened - a.opened);
  };
  return { total: rows.length, developers: tally(false), bots: tally(true) };
}

// ── printing ────────────────────────────────────────────────────────────────

export function printAreas(r: Awaited<ReturnType<typeof areas>>): void {
  console.log(`\nHours by area — ${r.built.draft.month}, ${r.total.toFixed(2)}h billed (from ${r.source})`);
  const line = (row: { pct: number; hours: number; area: string }) =>
    console.log(`  ${row.pct.toFixed(1).padStart(5)}%  ${row.hours.toFixed(1).padStart(6)}h  ${row.area}`);
  r.themes.forEach(line);
  console.log('  top areas:');
  r.rows.forEach(line);
  if (r.unassigned.length)
    console.log(
      `\n${r.unassigned.length} item(s) carry no ticket with a Linear project (${r.unassigned
        .reduce((n, u) => n + u.hours, 0)
        .toFixed(1)}h). Assign them in ${r.file} — see SKILL.md.`,
    );
}

export function printPrs(r: ReturnType<typeof prsByDeveloper>, month: string, org: string): void {
  console.log(`\nPRs opened in ${org} — ${month}: ${r.total}`);
  console.log(
    `  ${'developer'.padEnd(20)}${'opened'.padStart(7)}${'merged'.padStart(8)}${'closed'.padStart(8)}${'open'.padStart(6)}${'repos'.padStart(7)}${'crew'.padStart(6)}`,
  );
  for (const d of [...r.developers, ...r.bots])
    console.log(
      `  ${d.author.padEnd(20)}${String(d.opened).padStart(7)}${String(d.merged).padStart(8)}${String(d.closed).padStart(8)}${String(d.open).padStart(6)}${String(d.repos).padStart(7)}${String(d.crew).padStart(6)}`,
    );
  console.log('  closed = closed without merging; crew = body names a Firstmate crew (the only reliable agent marker)');
}
