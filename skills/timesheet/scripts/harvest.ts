/** Harvest v2: one duration entry per day, keyed by external_reference so re-runs update in place. */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fail } from './evidence.ts';
import type { Draft } from './draft.ts';

const REF_PREFIX = 'timesheet'; // external_reference.id = "timesheet:YYYY-MM-DD"
const REQUIRED = ['HARVEST_ACCOUNT_ID', 'HARVEST_TOKEN', 'HARVEST_PROJECT', 'HARVEST_TASK'] as const;
type Config = Record<(typeof REQUIRED)[number], string>;

export function harvestEnvPath(): string {
  const p = process.env.HARVEST_ENV ?? '~/.config/datafaced/harvest.env';
  return p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

export function harvestConfig(): Config {
  const cfg: Record<string, string> = {};
  const file = harvestEnvPath();
  if (existsSync(file))
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const i = line.indexOf('=');
      const k = line
        .slice(0, i)
        .trim()
        .replace(/^export /, '');
      if (i > 0 && !k.startsWith('#'))
        cfg[k] = line
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, '');
    }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith('HARVEST_') && v) cfg[k] = v;
  const missing = REQUIRED.filter((k) => !cfg[k]);
  if (missing.length) fail(`missing ${missing.join(', ')} — set them in ${file} (see the skill's SKILL.md)`);
  return cfg as Config;
}

async function harvest(cfg: Config, method: string, path: string, body?: unknown): Promise<any> {
  const r = await fetch('https://api.harvestapp.com/v2' + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${cfg.HARVEST_TOKEN}`,
      'Harvest-Account-Id': cfg.HARVEST_ACCOUNT_ID,
      'User-Agent': 'dotai-timesheet (andre.dreyer@rockofeye.ai)',
      'Content-Type': 'application/json',
    },
  });
  const text = await r.text();
  if (!r.ok) fail(`Harvest ${method} ${path} → ${r.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function pages(cfg: Config, path: string, key: string): Promise<any[]> {
  const out: any[] = [];
  for (let url: string | null = path; url;) {
    const r = await harvest(cfg, 'GET', url);
    out.push(...r[key]);
    url = r.links?.next ? r.links.next.split('/v2')[1] : null;
  }
  return out;
}

/** Accept project/task as an id or an exact name (case-insensitive). */
async function resolveAssignment(cfg: Config) {
  const wantP = cfg.HARVEST_PROJECT.toLowerCase();
  const wantT = cfg.HARVEST_TASK.toLowerCase();
  for (const pa of await pages(cfg, '/users/me/project_assignments?per_page=100', 'project_assignments')) {
    const p = pa.project;
    if ([String(p.id), p.name.toLowerCase(), (p.code ?? '').toLowerCase()].includes(wantP)) {
      for (const ta of pa.task_assignments)
        if ([String(ta.task.id), ta.task.name.toLowerCase()].includes(wantT)) return { project: p, task: ta.task };
      fail(
        `task ${cfg.HARVEST_TASK} not assigned on project ${p.name}: ${pa.task_assignments.map((t: any) => t.task.name)}`,
      );
    }
  }
  fail(`project ${cfg.HARVEST_PROJECT} not among your Harvest project assignments`);
}

export type Entry = { date: string; hours: number; byTool: boolean; locked: boolean };

/** Every entry on the configured project/task for a date range — the invoice as it stands. */
export async function harvestEntries(from: string, to: string): Promise<Entry[]> {
  const cfg = harvestConfig();
  const me = await harvest(cfg, 'GET', '/users/me');
  const { project, task } = await resolveAssignment(cfg);
  const rows = await pages(
    cfg,
    `/time_entries?user_id=${me.id}&project_id=${project.id}&from=${from}&to=${to}&per_page=100`,
    'time_entries',
  );
  return rows
    .filter((e) => e.task.id === task.id)
    .map((e) => ({
      date: e.spent_date,
      hours: e.hours,
      byTool: String(e.external_reference?.id ?? '').startsWith(`${REF_PREFIX}:`),
      locked: e.is_locked,
    }));
}

export async function push(r: Draft, apply: boolean): Promise<void> {
  const cfg = harvestConfig();
  const me = await harvest(cfg, 'GET', '/users/me');
  const { project, task } = await resolveAssignment(cfg);
  const first = r.days[0].date;
  const last = r.days.at(-1)!.date;
  const existing = new Map<string, any[]>();
  for (const e of await pages(
    cfg,
    `/time_entries?user_id=${me.id}&project_id=${project.id}&from=${first}&to=${last}&per_page=100`,
    'time_entries',
  ))
    if (e.task.id === task.id) existing.set(e.spent_date, [...(existing.get(e.spent_date) ?? []), e]);

  console.log(`Harvest: ${me.first_name} ${me.last_name} · ${project.name} / ${task.name}`);
  type Op = 'skip' | 'delete' | 'update' | 'same' | 'create';
  const plan: { op: Op; day: Draft['days'][number]; entry?: any; why: string }[] = [];
  for (const day of r.days) {
    const ref = `${REF_PREFIX}:${day.date}`;
    const all = existing.get(day.date) ?? [];
    const mine = all.filter((e) => e.external_reference?.id === ref);
    const other = all.filter((e) => !mine.includes(e));
    const m = mine[0];
    if (other.length)
      plan.push({ op: 'skip', day, why: `${other.length} entry(ies) not made by this tool — left alone` });
    else if (m && mine.some((e) => e.is_locked)) plan.push({ op: 'skip', day, why: `locked: ${m.locked_reason}` });
    else if (m && day.hours === 0) plan.push({ op: 'delete', day, entry: m, why: `${m.hours}h → 0` });
    else if (m && (m.hours !== day.hours || (m.notes ?? '') !== day.notes))
      plan.push({
        op: 'update',
        day,
        entry: m,
        why: m.hours !== day.hours ? `${m.hours}h → ${day.hours}h` : `${day.hours}h, notes only`,
      });
    else if (m) plan.push({ op: 'same', day, entry: m, why: '' });
    else if (day.hours) plan.push({ op: 'create', day, why: `${day.hours}h` });
  }
  for (const p of plan) if (p.op !== 'same') console.log(`  ${p.op.padEnd(7)}${p.day.date}  ${p.why}`);
  const billed = plan.filter((p) => ['create', 'update', 'same'].includes(p.op)).reduce((n, p) => n + p.day.hours, 0);
  console.log(`\nthis tool's entries after push: ${billed.toFixed(1)}h  (draft total ${r.total.toFixed(1)}h)`);
  if (!apply) {
    console.log('dry run — re-run with --apply to write to Harvest');
    return;
  }
  for (const p of plan) {
    const body: Record<string, unknown> = { hours: p.day.hours, notes: p.day.notes };
    if (p.op === 'create') {
      const ref = {
        id: `${REF_PREFIX}:${p.day.date}`,
        group_id: `${REF_PREFIX}:${r.month}`,
        permalink: 'https://github.com/dr3dr3/dotai/tree/main/skills/timesheet',
      };
      Object.assign(body, {
        project_id: project.id,
        task_id: task.id,
        spent_date: p.day.date,
        external_reference: ref,
      });
      const made = await harvest(cfg, 'POST', '/time_entries', body);
      if (made.external_reference?.id !== ref.id)
        fail(
          `Harvest dropped external_reference on entry ${made.id} — stopping, because re-runs would duplicate entries`,
        );
    } else if (p.op === 'update') await harvest(cfg, 'PATCH', `/time_entries/${p.entry.id}`, body);
    else if (p.op === 'delete') await harvest(cfg, 'DELETE', `/time_entries/${p.entry.id}`);
  }
  console.log('applied');
}
