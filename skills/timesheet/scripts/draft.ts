/** A month's draft: billed hours per day, with the note each Harvest entry carries. */
import {
  SLOT_MS,
  billSlots,
  claudeEvents,
  loadGithub,
  loadMeetings,
  localDate,
  localTime,
  monthBounds,
  weekday,
  type Ev,
  type Meeting,
  type Prompt,
} from './evidence.ts';

export type Options = {
  month: string;
  tz: string;
  gapFill: number;
  minDay: number;
  maxDay: number;
  sources: string[];
  meetings?: string;
  org: string;
  user: string;
  refresh?: boolean;
};

export type Day = {
  date: string;
  measured: number;
  hours: number;
  rule: '' | 'under minimum' | 'capped';
  span: string;
  counts: Record<string, number>;
  notes: string;
};

export type Draft = {
  month: string;
  tz: string;
  gap_fill: number;
  min_day: number;
  max_day: number;
  sources: string[];
  claude_from: string | null;
  days: Day[];
  total: number;
};

export type Built = {
  draft: Draft;
  events: (Ev & { prompt?: Prompt })[];
  meetings: Meeting[];
  slots: Set<number>;
};

const TICKET = /\b(ENG|AGE)-\d+\b/g;
const CONVENTIONAL = /^(\w+)(\([^)]*\))?!?:\s*/;
const STRIP = ' ()[]-—';

function strip(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && STRIP.includes(s[a])) a++;
  while (b > a && STRIP.includes(s[b - 1])) b--;
  return s.slice(a, b);
}

export function tickets(text: string): string[] {
  return [...text.matchAll(TICKET)].map((m) => m[0]);
}

export function dayNote(texts: string[], meetings: string[], limit = 6): string {
  const ids = [...new Set(texts.flatMap(tickets))].sort(
    (a, b) => +a.split('-')[1] - +b.split('-')[1] || a.localeCompare(b),
  );
  const seen = new Set<string>();
  const items: string[] = [];
  for (const t of texts) {
    // PR titles come first: they describe the work better than commits
    const i = t.indexOf(': ');
    const repo = i < 0 ? t : t.slice(0, i);
    const title = strip((i < 0 ? '' : t.slice(i + 2)).replace(CONVENTIONAL, '').replace(TICKET, ''));
    const key = title.toLowerCase().slice(0, 50);
    if (title && !seen.has(key)) {
      seen.add(key);
      items.push(`${repo.split('/').at(-1)!.replaceAll('rock-of-eye-', '')}: ${title}`);
    }
  }
  const parts: string[] = [];
  if (ids.length) parts.push(ids.slice(0, 10).join(', ') + (ids.length > 10 ? ` +${ids.length - 10}` : ''));
  if (meetings.length) parts.push('Meetings: ' + [...new Set(meetings)].sort().join('; '));
  parts.push(...items.slice(0, limit));
  if (items.length > limit) parts.push(`+${items.length - limit} more`);
  return parts.join(' · ');
}

const EVIDENCE_LABELS: [string, string, string][] = [
  ['claude', 'prompt', 'prompts'],
  ['commit', 'commit', 'commits'],
  ['pr', 'PR/issue', 'PRs/issues'],
  ['meeting', 'meeting', 'meetings'],
];

/**
 * First segment of every Harvest note: what the hours rest on, so a reader can tell a
 * tool-measured day from one typed by hand (which carries no such line).
 */
export function evidenceLine(measured: number, billed: number, span: string, counts: Record<string, number>): string {
  const adj = billed < measured ? `, capped at ${billed}h` : '';
  const ev = EVIDENCE_LABELS.filter(([k]) => counts[k])
    .map(([k, one, many]) => `${counts[k]} ${counts[k] === 1 ? one : many}`)
    .join(', ');
  return `[timesheet ✓ ${measured}h measured${adj} · ${span} · ${ev}]`;
}

export function build(o: Options): Built {
  const { start, end, days: dates } = monthBounds(o.month, o.tz);
  const srcs = new Set(o.sources);
  const events: Built['events'] = [];
  if (srcs.has('claude')) events.push(...claudeEvents(start, end));
  if (srcs.has('commit') || srcs.has('pr'))
    events.push(...loadGithub(o.month, start, end, o).filter((e) => srcs.has(e.src)));
  const meetings = srcs.has('meeting') ? loadMeetings(o.meetings, start, end) : [];
  const slots = billSlots(
    events.map((e) => e.t),
    meetings.map((m) => [m.start, m.end]),
    o.gapFill,
  );

  const byDay = new Map<string, number[]>();
  for (const s of [...slots].sort((a, b) => a - b)) {
    const d = localDate(s, o.tz);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const days: Day[] = dates.map((date) => {
    const sl = byDay.get(date) ?? [];
    const ev = events.filter((e) => localDate(e.t, o.tz) === date);
    const texts = [...ev]
      .sort((a, b) => Number(a.src !== 'pr') - Number(b.src !== 'pr') || a.t - b.t)
      .map((e) => e.text)
      .filter(Boolean);
    const mt = meetings.filter((m) => localDate(m.start, o.tz) === date).map((m) => m.title);
    const measured = sl.length * 0.5;
    // A day under the minimum is not logged at all; a long day is billed at the maximum.
    const hours = measured < o.minDay ? 0 : Math.min(measured, o.maxDay);
    const span = sl.length ? `${localTime(sl[0], o.tz)}–${localTime(sl.at(-1)! + SLOT_MS, o.tz)}` : '';
    const counts: Record<string, number> = {};
    for (const e of ev) counts[e.src] = (counts[e.src] ?? 0) + 1;
    if (mt.length) counts.meeting = mt.length;
    return {
      date,
      measured,
      hours,
      rule: measured && !hours ? 'under minimum' : hours < measured ? 'capped' : '',
      span,
      counts,
      notes: hours ? [evidenceLine(measured, hours, span, counts), dayNote(texts, mt)].filter(Boolean).join(' · ') : '',
    };
  });
  const claude = events.filter((e) => e.src === 'claude').map((e) => e.t);
  return {
    draft: {
      month: o.month,
      tz: o.tz,
      gap_fill: o.gapFill,
      min_day: o.minDay,
      max_day: o.maxDay,
      sources: [...srcs].sort(),
      claude_from: claude.length
        ? `${localDate(Math.min(...claude), o.tz)}T${localTime(Math.min(...claude), o.tz)}`
        : null,
      days,
      total: days.reduce((n, d) => n + d.hours, 0),
    },
    events,
    meetings,
    slots,
  };
}

const f1 = (n: number) => n.toFixed(1);

export function printDraft(r: Draft, notes = true): void {
  console.log(
    `${r.month}  tz=${r.tz}  gap-fill=${r.gap_fill}m  day=${r.min_day}–${r.max_day}h  sources=${r.sources.join(',')}`,
  );
  if (r.claude_from?.startsWith(r.month))
    console.log(`Claude evidence starts ${r.claude_from} — earlier days rest on GitHub alone`);
  console.log(
    `\n${'date'.padEnd(11)}${'dow'.padEnd(4)}${'hours'.padStart(6)}${'meas'.padStart(6)}  ${'span'.padEnd(12)} evidence`,
  );
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let week = 0;
  r.days.forEach((x, i) => {
    const ev = Object.entries(x.counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    const meas = x.rule ? f1(x.measured).padStart(6) : '';
    console.log(
      `${x.date.padEnd(11)}${dow[weekday(x.date)]} ${f1(x.hours).padStart(6)}${meas.padStart(6)}  ${x.span.padEnd(12)} ${ev}` +
        (x.rule ? `  (${x.rule})` : ''),
    );
    if (notes && x.notes) console.log(' '.repeat(23) + x.notes.slice(0, 160));
    week += x.hours;
    if (weekday(x.date) === 0 || i === r.days.length - 1) {
      console.log(`${''.padEnd(11)}${'wk'.padEnd(4)}${f1(week).padStart(6)}`);
      week = 0;
    }
  });
  console.log(`\ntotal ${f1(r.total)}h`);
}
