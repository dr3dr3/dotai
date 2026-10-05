#!/usr/bin/env node
/**
 * Draft a month's Datafaced timesheet from activity evidence, push it to Harvest, and report
 * where the hours went.
 *
 *   timesheet.ts archive                  merge Claude transcripts into the ledger (SessionStart hook)
 *   timesheet.ts draft 2026-09            per-day hours + notes; writes nothing remote
 *   timesheet.ts push 2026-09             what would change in Harvest (dry run)
 *   timesheet.ts push 2026-09 --apply     create/update one entry per day in Harvest
 *   timesheet.ts report 2026-09           hours by Linear project + PRs by developer
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { archive } from './evidence.ts';
import { build, printDraft, type Options } from './draft.ts';
import { push } from './harvest.ts';
import { areas, printAreas, printPrs, prsByDeveloper } from './report.ts';

const USAGE = `usage: timesheet.ts <archive|draft|push|report> [YYYY-MM] [options]

common:  --tz ZONE (Australia/Brisbane)  --gap-fill MIN (30)  --min-day H (1)  --max-day H (14)
         --sources claude,commit,pr,meeting  --meetings FILE  --org rock-of-eye  --user dr3dr3
         --refresh (re-fetch GitHub)
archive: --quiet
draft:   --json FILE  --no-notes
push:    --apply
report:  --from-harvest (scale to the invoice)  --assignments FILE  --json FILE
         --unassigned-json FILE  --no-prs  --refresh-linear`;

export async function main(argv: string[]): Promise<void> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tz: { type: 'string', default: process.env.TIMESHEET_TZ ?? 'Australia/Brisbane' },
      'gap-fill': { type: 'string', default: '30' },
      'min-day': { type: 'string', default: '1' },
      'max-day': { type: 'string', default: '14' },
      sources: { type: 'string', default: 'claude,commit,pr,meeting' },
      meetings: { type: 'string' },
      org: { type: 'string', default: 'rock-of-eye' },
      user: { type: 'string', default: 'dr3dr3' },
      refresh: { type: 'boolean' },
      quiet: { type: 'boolean' },
      json: { type: 'string' },
      'no-notes': { type: 'boolean' },
      apply: { type: 'boolean' },
      'from-harvest': { type: 'boolean' },
      assignments: { type: 'string' },
      'unassigned-json': { type: 'string' },
      'no-prs': { type: 'boolean' },
      'refresh-linear': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [cmd, month] = positionals;
  if (v.help || !cmd) return console.log(USAGE);
  if (cmd === 'archive') {
    const r = archive();
    if (!v.quiet) console.log(`ledger: +${r.added} (total ${r.total})`);
    return;
  }
  if (!['draft', 'push', 'report'].includes(cmd) || !month) throw new Error(USAGE);
  const num = (k: 'gap-fill' | 'min-day' | 'max-day') => {
    const n = Number(v[k]);
    if (!Number.isFinite(n)) throw new Error(`--${k} must be a number`);
    return n;
  };
  const o: Options = {
    month,
    tz: v.tz!,
    gapFill: num('gap-fill'),
    minDay: num('min-day'),
    maxDay: num('max-day'),
    sources: v.sources!.split(','),
    meetings: v.meetings,
    org: v.org!,
    user: v.user!,
    refresh: v.refresh,
  };
  if (cmd === 'draft') {
    const { draft } = build(o);
    if (v.json) writeFileSync(v.json, JSON.stringify(draft, null, 1));
    printDraft(draft, !v['no-notes']);
  } else if (cmd === 'push') {
    await push(build(o).draft, Boolean(v.apply));
  } else {
    const a = await areas({
      ...o,
      assignments: v.assignments,
      fromHarvest: v['from-harvest'],
      refreshLinear: v['refresh-linear'],
    });
    printAreas(a);
    const prs = v['no-prs'] ? null : prsByDeveloper(month, o.tz, o.org, o.refresh);
    if (prs) printPrs(prs, month, o.org);
    if (v['unassigned-json'])
      writeFileSync(v['unassigned-json'], JSON.stringify({ allowed: a.allowed, items: a.unassigned }, null, 1));
    if (v.json)
      writeFileSync(
        v.json,
        JSON.stringify({ month, source: a.source, total: a.total, areas: a.rows, all_areas: a.all, prs }, null, 1),
      );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
