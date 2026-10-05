// The slot model, evidence filter, area attribution and PR tally behind the timesheet — the
// parts an invoice and a founder report depend on. No network: GitHub, Linear and Harvest are
// not touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archive, billSlots, SLOT_MS } from '../scripts/evidence.ts';
import { build, evidenceLine, type Built, type Options } from '../scripts/draft.ts';
import {
  attribute,
  decisionKey,
  itemOf,
  MANUAL,
  prsByDeveloper,
  summarise,
  themeOf,
  UNASSIGNED,
} from '../scripts/report.ts';

const TMP = mkdtempSync(join(tmpdir(), 'timesheet-'));
process.env.TIMESHEET_HOME = join(TMP, 'home');
process.env.CLAUDE_PROJECTS = join(TMP, 'projects');
test.after(() => rmSync(TMP, { recursive: true, force: true }));

function msg(uuid: string, ts: string, text: string, extra: Record<string, unknown> = {}) {
  return (
    JSON.stringify({
      type: 'user',
      uuid,
      timestamp: ts,
      sessionId: 's1',
      gitBranch: 'feat/eng-9999-unrelated',
      origin: { kind: 'human' },
      permissionMode: 'auto',
      message: { role: 'user', content: text },
      ...extra,
    }) + '\n'
  );
}

function writeTranscripts() {
  const ws = join(TMP, 'projects', '-workspace');
  const crew = join(TMP, 'projects', '-workspace-repos-api--treehouse-x');
  mkdirSync(ws, { recursive: true });
  mkdirSync(crew, { recursive: true });
  // Brisbane is UTC+10: 2026-09-02T00:05Z is 10:05 local.
  writeFileSync(
    join(ws, 'a.jsonl'),
    msg('u1', '2026-09-02T00:05:00Z', 'start') + // slot 10:00
      msg('u2', '2026-09-02T00:50:00Z', 'continue') + // slot 10:30
      msg('u3', '2026-09-02T01:40:00Z', 'after 30m gap') + // slot 11:30 -> 11:00 bridged
      msg('u4', '2026-09-02T03:10:00Z', 'after 60m gap') + // slot 13:00, 12:00-13:00 NOT bridged
      msg('x1', '2026-09-02T05:00:00Z', '<task-notification>done</task-notification>') +
      msg('x2', '2026-09-02T06:00:00Z', 'agent', { permissionMode: 'bypassPermissions' }) +
      msg('x3', '2026-09-02T07:00:00Z', 'meta', { isMeta: true }) +
      JSON.stringify({ type: 'ai-title', aiTitle: 'Raja order form', sessionId: 's1' }) +
      '\n',
  );
  writeFileSync(join(ws, 'b.jsonl'), msg('u1', '2026-09-02T00:05:00Z', 'start')); // a resumed session repeats u1
  writeFileSync(join(crew, 'c.jsonl'), msg('w1', '2026-09-03T00:00:00Z', 'crew worker'));
}

const opts = (extra: Partial<Options> = {}): Options => ({
  month: '2026-09',
  tz: 'Australia/Brisbane',
  gapFill: 30,
  minDay: 1,
  maxDay: 14,
  sources: ['claude', 'meeting'],
  org: 'rock-of-eye',
  user: 'dr3dr3',
  ...extra,
});

test('archive keeps metadata only, dedupes, and backfills old rows', () => {
  mkdirSync(process.env.TIMESHEET_HOME!, { recursive: true });
  // a row archived before session/branch were kept
  writeFileSync(
    join(process.env.TIMESHEET_HOME!, 'claude-prompts.jsonl'),
    JSON.stringify({ uuid: 'u2', ts: '2026-09-02T00:50:00Z', project: '-workspace' }) + '\n',
  );
  writeTranscripts();
  assert.deepEqual(archive(), { added: 3, total: 4 });
  assert.deepEqual(archive(), { added: 0, total: 4 });
  const ledger = readFileSync(join(process.env.TIMESHEET_HOME!, 'claude-prompts.jsonl'), 'utf8');
  assert.doesNotMatch(ledger, /start|continue|gap/, 'the ledger must not keep prompt text');
  const u2 = ledger
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .find((r) => r.uuid === 'u2');
  assert.equal(u2.session, 's1');
  assert.equal(u2.branch, 'feat/eng-9999-unrelated');
  const titles = JSON.parse(readFileSync(join(process.env.TIMESHEET_HOME!, 'claude-sessions.json'), 'utf8'));
  assert.equal(titles.s1, 'Raja order form');
});

test('the draft bills from the ledger alone, with the day limits and evidence marker', () => {
  rmSync(join(TMP, 'projects'), { recursive: true, force: true }); // transcripts pruned
  const meetings = join(TMP, 'meetings.json');
  writeFileSync(
    meetings,
    JSON.stringify([
      { start: '2026-09-04T09:00:00+10:00', end: '2026-09-04T10:00:00+10:00', title: 'Weekly with Mark' },
      { start: '2026-09-05T09:00:00+10:00', end: '2026-09-05T09:30:00+10:00', title: 'Quick sync' },
      { start: '2026-09-06T06:00:00+10:00', end: '2026-09-06T22:00:00+10:00', title: 'Offsite' },
    ]),
  );
  const { draft } = build(opts({ meetings }));
  const day = Object.fromEntries(draft.days.map((d) => [d.date, d]));
  assert.equal(day['2026-09-02'].hours, 2.5); // 10:00-12:00 + 13:00
  assert.equal(day['2026-09-02'].span, '10:00–13:30');
  assert.equal(day['2026-09-02'].notes, '[timesheet ✓ 2.5h measured · 10:00–13:30 · 4 prompts]');
  assert.equal(day['2026-09-03'].hours, 0, 'crew worktree prompts must not bill');
  assert.equal(day['2026-09-04'].hours, 1, '1h is enough');
  assert.match(day['2026-09-04'].notes, /Weekly with Mark/);
  assert.equal(day['2026-09-05'].measured, 0.5);
  assert.equal(day['2026-09-05'].hours, 0, 'under 1h is not logged');
  assert.equal(day['2026-09-05'].notes, '');
  assert.equal(day['2026-09-06'].hours, 14);
  assert.ok(day['2026-09-06'].notes.startsWith('[timesheet ✓ 16h measured, capped at 14h · 06:00–22:00 · 1 meeting]'));
  assert.equal(draft.total, 17.5);
});

test('evidence wording', () => {
  assert.equal(
    evidenceLine(2, 2, '10:00–12:00', { pr: 2, commit: 1 }),
    '[timesheet ✓ 2h measured · 10:00–12:00 · 1 commit, 2 PRs/issues]',
  );
});

test('gap rule', () => {
  const t0 = Date.parse('2026-09-02T00:00:00Z');
  assert.equal(billSlots([t0, t0 + 2 * SLOT_MS], [], 30).size, 3, 'a 30m gap is bridged');
  assert.equal(billSlots([t0, t0 + 3 * SLOT_MS], [], 30).size, 2, 'a 60m gap is not');
});

// ── areas ───────────────────────────────────────────────────────────────────

const T0 = Date.parse('2026-09-07T00:00:00Z'); // 10:00 Brisbane, a Monday
function fixture(): { built: Built; items: Map<number, ReturnType<typeof itemOf>> } {
  const events = [
    { t: T0, src: 'pr' as const, text: 'rock-of-eye/rock-of-eye-api: feat(order): ENG-1 a' }, // slot 10:00
    { t: T0 + 60_000, src: 'pr' as const, text: 'rock-of-eye/local-dev-env: chore: tooling' }, // slot 10:00
    { t: T0 + 2 * SLOT_MS, src: 'pr' as const, text: 'rock-of-eye/rock-of-eye-api: fix: ENG-1 b' }, // slot 11:00
  ];
  const built = {
    draft: {} as Built['draft'],
    events,
    meetings: [],
    slots: billSlots(
      events.map((e) => e.t),
      [],
      30,
    ),
  };
  const items = new Map(events.map((e, i) => [i, itemOf(e, {})]));
  return { built, items };
}

test('slot hours are shared among the evidence inside, and a bridged slot averages its neighbours', () => {
  const { built, items } = fixture();
  const perDay = attribute(built, items, 'Australia/Brisbane').get('2026-09-07')!;
  const a = 'pr:rock-of-eye/rock-of-eye-api: feat(order): ENG-1 a';
  const tooling = 'pr:rock-of-eye/local-dev-env: chore: tooling';
  const b = 'pr:rock-of-eye/rock-of-eye-api: fix: ENG-1 b';
  // 10:00 split a/tooling; 10:30 bridged = avg(10:00, 11:00); 11:00 all b
  assert.equal(perDay.get(a), 0.25 + 0.125);
  assert.equal(perDay.get(tooling), 0.25 + 0.125);
  assert.equal(perDay.get(b), 0.25 + 0.5);
});

test('areas scale to the billed day, mark manual days, and roll the tail into Other', () => {
  const { built, items } = fixture();
  const perDay = attribute(built, items, 'Australia/Brisbane');
  const areaOf = (k: string) => (k.includes('ENG-1') ? 'P4 Orders' : UNASSIGNED);
  const decision = (k: string) => ({ key: k, label: k });
  const r = summarise(
    perDay,
    new Map([
      ['2026-09-07', 3],
      ['2026-09-08', 2],
    ]),
    areaOf,
    decision,
    [],
  );
  assert.equal(r.total, 5);
  const by = Object.fromEntries(r.all.map((x) => [x.area, x.hours]));
  assert.equal(by['P4 Orders'], 2.25); // (0.375 + 0.75) / 1.5 * 3
  assert.equal(by[UNASSIGNED], 0.75);
  assert.equal(by[MANUAL], 2, 'a billed day with no evidence is reported as manual, not spread');
  assert.equal(r.unassigned.length, 1);
  assert.equal(themeOf('P12 Production Portal'), 'Product');
  assert.equal(themeOf('T13 AI operating model & agent ecosystem'), 'Platform & engineering');
  assert.equal(themeOf('Onboard - Raja'), 'Tenant onboarding');
  assert.equal(themeOf('Meetings'), 'Meetings');

  const many = new Map([
    ['2026-09-07', new Map(Array.from({ length: 12 }, (_, i) => [`k${i}`, i + 1] as [string, number]))],
  ]);
  const top = summarise(many, new Map([['2026-09-07', 78]]), (k) => k, decision, []);
  assert.equal(top.rows.length, 10);
  assert.equal(top.rows.at(-1)!.area, 'Other (3 areas)');
  assert.equal(top.rows.at(-1)!.hours, 1 + 2 + 3);
});

test('a Claude session takes no ticket from the checkout branch', () => {
  const it = itemOf(
    {
      t: 0,
      src: 'claude',
      text: '',
      prompt: {
        uuid: 'u',
        ts: '2026-09-02T00:00:00Z',
        project: '-workspace',
        session: 's1',
        branch: 'feat/eng-3669-x',
      },
    } as Built['events'][number],
    { s1: 'Email mandatory in client profile' },
  );
  assert.deepEqual(it.tickets, []);
  assert.match(it.label, /Email mandatory in client profile.*eng-3669/);
  const pr = itemOf({ t: 0, src: 'pr', text: 'rock-of-eye/api: fix: ENG-7 x' }, {});
  assert.equal(decisionKey(pr, { 'ENG-7': { project: null, title: 't', labels: [] } }), 'ticket:ENG-7');
  assert.equal(decisionKey(pr, {}), pr.key, 'a ticket Linear does not know cannot group');
});

test('PRs by developer: counts per state, bots apart, crew marker', () => {
  mkdirSync(join(process.env.TIMESHEET_HOME!, 'cache'), { recursive: true });
  const row = (author: string, state: string, merged: boolean, extra = {}) => ({
    created: '2026-09-10T00:00:00Z',
    author,
    bot: false,
    state,
    merged,
    repo: 'api',
    crew: false,
    ...extra,
  });
  writeFileSync(
    join(process.env.TIMESHEET_HOME!, 'cache', 'prs-rock-of-eye-2026-09.json'),
    JSON.stringify([
      row('dev', 'closed', true, { crew: true }),
      row('dev', 'closed', false, { repo: 'sso' }),
      row('dev', 'open', false),
      row('other', 'closed', true),
      row('dependabot[bot]', 'open', false, { bot: true }),
      row('dev', 'closed', true, { created: '2026-10-01T00:00:00Z' }), // outside the month
    ]),
  );
  const r = prsByDeveloper('2026-09', 'Australia/Brisbane', 'rock-of-eye');
  assert.equal(r.total, 5);
  assert.deepEqual(r.developers[0], { author: 'dev', opened: 3, merged: 1, closed: 1, open: 1, repos: 2, crew: 1 });
  assert.equal(r.bots[0].author, 'dependabot[bot]');
});
