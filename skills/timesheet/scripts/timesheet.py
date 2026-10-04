#!/usr/bin/env python3
"""Draft a month's Datafaced timesheet from activity evidence, and push it to Harvest.

  timesheet.py archive                 copy typed-prompt timestamps into the ledger (SessionStart hook)
  timesheet.py draft 2026-09           per-day hours + notes; writes nothing remote
  timesheet.py push 2026-09            show what would change in Harvest (dry run)
  timesheet.py push 2026-09 --apply    create/update one entry per day in Harvest

Evidence (one timestamp per event):
  claude   prompts André typed into Claude Code (live transcripts + the ledger)
  commit   GitHub commits authored by dr3dr3 in --org (search API, author date)
  pr       issues/PRs dr3dr3 opened in --org (search API, created_at)
  meeting  intervals from --meetings FILE (the skill fills this from Google Calendar)

Slot model, deliberately conservative (agreed 2026-10-04): a 30-min slot is billed when it
holds an event or a meeting, or sits in a gap of <= --gap-fill minutes between two billed
slots. No lead-in before a session's first event.
"""
import argparse
import collections
import datetime as dt
import glob
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request
from zoneinfo import ZoneInfo

SLOT = dt.timedelta(minutes=30)
HOME = os.path.expanduser(os.environ.get(
    'TIMESHEET_HOME', '~/.ai/timesheet' if os.path.isdir(os.path.expanduser('~/.ai')) else '~/.local/share/timesheet'))
LEDGER = os.path.join(HOME, 'claude-prompts.jsonl')
HARVEST_ENV = os.path.expanduser(os.environ.get('HARVEST_ENV', '~/.config/datafaced/harvest.env'))
TRANSCRIPTS = os.path.expanduser(os.environ.get('CLAUDE_PROJECTS', '~/.claude/projects'))
REF_PREFIX = 'timesheet'  # external_reference.id = "timesheet:YYYY-MM-DD"


# ── evidence ────────────────────────────────────────────────────────────────

def typed_prompts():
    """Yield (uuid, iso_ts, project) for every prompt a human typed into Claude Code.

    Excluded: Firstmate crew worktrees and launch briefs, bypassPermissions sessions (agents),
    sub-agents, meta/injected messages (<task-notification>, <command-name>, hook output)."""
    for f in glob.glob(os.path.join(TRANSCRIPTS, '*', '**', '*.jsonl'), recursive=True):
        proj = os.path.relpath(f, TRANSCRIPTS).split(os.sep)[0]
        if '--treehouse-' in proj:
            continue
        with open(f, errors='replace') as fh:
            for line in fh:
                if '"human"' not in line:
                    continue
                try:
                    d = json.loads(line)
                except ValueError:
                    continue
                if d.get('type') != 'user' or d.get('isSidechain') or d.get('isMeta'):
                    continue
                if (d.get('origin') or {}).get('kind') != 'human' or d.get('permissionMode') == 'bypassPermissions':
                    continue
                c = (d.get('message') or {}).get('content')
                if isinstance(c, list):
                    c = ' '.join(b.get('text', '') for b in c if isinstance(b, dict) and b.get('type') == 'text')
                t = (c or '').strip()
                if not t or t.startswith('<') or 'FIRSTMATE_OP' in t:
                    continue
                yield d['uuid'], d['timestamp'], proj


def read_ledger():
    rows = {}
    if os.path.exists(LEDGER):
        for line in open(LEDGER):
            try:
                r = json.loads(line)
                rows[r['uuid']] = r
            except (ValueError, KeyError):
                pass
    return rows


def cmd_archive(_a):
    """Append prompts not yet in the ledger. Timestamps only — no prompt text is kept."""
    os.makedirs(HOME, exist_ok=True)
    seen = read_ledger()
    new = {}
    for u, ts, p in typed_prompts():  # a resumed session repeats prompts in a second file
        if u not in seen:
            new.setdefault(u, {'uuid': u, 'ts': ts, 'project': p})
    new = list(new.values())
    if new:
        with open(LEDGER, 'a') as fh:
            for r in sorted(new, key=lambda r: r['ts']):
                fh.write(json.dumps(r) + '\n')
    if not _a.quiet:
        print(f'ledger {LEDGER}: +{len(new)} (total {len(seen) + len(new)})')


def claude_events(start, end):
    rows = read_ledger()
    for u, ts, p in typed_prompts():
        rows.setdefault(u, {'uuid': u, 'ts': ts, 'project': p})
    for r in rows.values():
        t = parse_ts(r['ts'])
        if start <= t < end:
            yield t, 'claude', ''


def gh_search(kind, q, field):
    page = 1
    while True:
        out = subprocess.run(['gh', 'api', '-X', 'GET', f'search/{kind}', '-f', f'q={q}',
                              '-f', 'per_page=100', '-f', f'page={page}'], capture_output=True, text=True)
        if out.returncode:
            sys.exit(f'gh search failed ({q}): {out.stderr.strip()}')
        body = json.loads(out.stdout)
        if body.get('incomplete_results'):
            print(f'warning: GitHub marked results incomplete for {q!r}', file=sys.stderr)
        yield from (field(i) for i in body['items'])
        time.sleep(2.2)  # search API allows 30 requests/min
        if len(body['items']) < 100:
            return
        if page == 10:
            sys.exit(f'more than 1000 results for {q!r}; the search API cannot page past that')
        page += 1


def github_events(start, end, user, org):
    """One query per day per kind: a busy month exceeds the search API's 1000-result cap."""
    day = (start - dt.timedelta(days=1)).date()  # search dates are UTC; pad both ends
    while day <= end.date():
        for ts, repo, msg in gh_search('commits', f'author:{user} org:{org} author-date:{day}',
                                       lambda i: (i['commit']['author']['date'], i['repository']['full_name'],
                                                  i['commit']['message'])):
            yield ts, 'commit', f'{repo}: {msg.splitlines()[0]}'
        for ts, repo, title in gh_search('issues', f'author:{user} org:{org} created:{day}', lambda i: (
                i['created_at'], '/'.join(i['repository_url'].rsplit('/', 2)[1:]), i['title'])):
            yield ts, 'pr', f'{repo}: {title}'
        day += dt.timedelta(days=1)


def load_github(start, end, a):
    """Cached per month once the month is over; a month in progress is always re-fetched."""
    cache = os.path.join(HOME, 'cache', f'github-{a.user}-{a.org}-{a.month}.json')
    if os.path.exists(cache) and not a.refresh:
        raw = json.load(open(cache))
    else:
        raw = list(github_events(start, end, a.user, a.org))
        if end <= dt.datetime.now(start.tzinfo):
            os.makedirs(os.path.dirname(cache), exist_ok=True)
            json.dump(raw, open(cache, 'w'))
    for ts, src, text in raw:
        t = parse_ts(ts)
        if start <= t < end and text.startswith(a.org + '/'):
            yield t, src, text


def load_meetings(path, start, end):
    """[{"start": iso, "end": iso, "title": str}, ...] — all-day events should be left out."""
    for m in json.load(open(path)) if path else []:
        s, e = parse_ts(m['start']), parse_ts(m['end'])
        if e > start and s < end:
            yield s, e, m.get('title', '')


def parse_ts(s):
    t = dt.datetime.fromisoformat(s.replace('Z', '+00:00'))
    if t.tzinfo is None:
        sys.exit(f'timestamp without a timezone: {s}')
    return t


# ── slot model ──────────────────────────────────────────────────────────────

def floor_slot(t, tz):
    t = t.astimezone(tz)
    return t.replace(minute=t.minute // 30 * 30, second=0, microsecond=0)


def bill_slots(points, intervals, tz, gap_fill):
    """points: datetimes; intervals: (start, end). Returns the set of billed slot starts."""
    slots = {floor_slot(t, tz) for t in points}
    for s, e in intervals:
        k = floor_slot(s, tz)
        while k < e:
            slots.add(k)
            k += SLOT
    active = sorted(slots)
    for prev, nxt in zip(active, active[1:]):
        if nxt - prev - SLOT <= dt.timedelta(minutes=gap_fill):
            k = prev + SLOT
            while k < nxt:
                slots.add(k)
                k += SLOT
    return slots


# ── draft ───────────────────────────────────────────────────────────────────

TICKET = re.compile(r'\b(ENG|AGE)-\d+\b')
CONVENTIONAL = re.compile(r'^(\w+)(\([^)]*\))?!?:\s*')


def day_note(texts, meetings, limit=6):
    tickets = sorted({m.group(0) for t in texts for m in TICKET.finditer(t)}, key=lambda x: int(x.split('-')[1]))
    seen, items = set(), []
    for t in texts:  # PR titles first: they describe the work better than commits
        repo, _, title = t.partition(': ')
        title = TICKET.sub('', CONVENTIONAL.sub('', title)).strip(' ()[]-—')
        key = title.lower()[:50]
        if title and key not in seen:
            seen.add(key)
            items.append(f"{repo.split('/')[-1].replace('rock-of-eye-', '')}: {title}")
    parts = []
    if tickets:
        parts.append(', '.join(tickets[:10]) + (f' +{len(tickets) - 10}' if len(tickets) > 10 else ''))
    if meetings:
        parts.append('Meetings: ' + '; '.join(sorted(set(meetings))))
    parts += items[:limit]
    if len(items) > limit:
        parts.append(f'+{len(items) - limit} more')
    return ' · '.join(parts)


EVIDENCE_LABELS = (('claude', 'prompt', 'prompts'), ('commit', 'commit', 'commits'),
                   ('pr', 'PR/issue', 'PRs/issues'), ('meeting', 'meeting', 'meetings'))


def evidence_line(measured, billed, span, counts):
    """First segment of every Harvest note: what the hours rest on, so a reader can tell a
    tool-measured day from one typed by hand (which carries no such line)."""
    adj = f', capped at {billed:g}h' if billed < measured else ''
    ev = ', '.join(f'{counts[k]} {one if counts[k] == 1 else many}'
                   for k, one, many in EVIDENCE_LABELS if counts.get(k))
    return f'[timesheet ✓ {measured:g}h measured{adj} · {span} · {ev}]'


def build(a):
    tz = ZoneInfo(a.tz)
    y, m = map(int, a.month.split('-'))
    start = dt.datetime(y, m, 1, tzinfo=tz)
    end = dt.datetime(y + m // 12, m % 12 + 1, 1, tzinfo=tz)
    srcs = set(a.sources.split(','))
    events = []
    if 'claude' in srcs:
        events += claude_events(start, end)
    if srcs & {'commit', 'pr'}:
        events += [e for e in load_github(start, end, a) if e[1] in srcs]
    meetings = list(load_meetings(a.meetings, start, end)) if 'meeting' in srcs else []
    slots = bill_slots([e[0] for e in events], [(s, e) for s, e, _ in meetings], tz, a.gap_fill)

    days = []
    d = start.date()
    while d < end.date():
        sl = sorted(s for s in slots if s.date() == d)
        ev = [e for e in events if e[0].astimezone(tz).date() == d]
        texts = [e[2] for e in sorted(ev, key=lambda e: (e[1] != 'pr', e[0])) if e[2]]
        mt = [t for s, _, t in meetings if s.astimezone(tz).date() == d]
        measured = len(sl) * 0.5
        # A day under the minimum is not logged at all; a long day is billed at the maximum.
        billed = 0.0 if measured < a.min_day else min(measured, a.max_day)
        span = f'{sl[0]:%H:%M}–{sl[-1] + SLOT:%H:%M}' if sl else ''
        counts = dict(collections.Counter(e[1] for e in ev), **({'meeting': len(mt)} if mt else {}))
        days.append({
            'date': d.isoformat(),
            'measured': measured,
            'hours': billed,
            'rule': 'under minimum' if measured and not billed else 'capped' if billed < measured else '',
            'span': span,
            'counts': counts,
            'notes': ' · '.join(filter(None, [evidence_line(measured, billed, span, counts), day_note(texts, mt)]))
                     if billed else '',
        })
        d += dt.timedelta(days=1)
    first_claude = min((e[0] for e in events if e[1] == 'claude'), default=None)
    return {'month': a.month, 'tz': a.tz, 'gap_fill': a.gap_fill, 'min_day': a.min_day, 'max_day': a.max_day,
            'sources': sorted(srcs),
            'claude_from': first_claude.astimezone(tz).isoformat() if first_claude else None,
            'days': days, 'total': sum(x['hours'] for x in days)}


def print_draft(r, notes=True):
    print(f"{r['month']}  tz={r['tz']}  gap-fill={r['gap_fill']}m  day={r['min_day']:g}–{r['max_day']:g}h"
          f"  sources={','.join(r['sources'])}")
    if r['claude_from'] and r['claude_from'][:7] == r['month']:
        print(f"Claude evidence starts {r['claude_from'][:16]} — earlier days rest on GitHub alone")
    print(f"\n{'date':<11}{'dow':<4}{'hours':>6}{'meas':>6}  {'span':<12} evidence")
    week = 0.0
    for x in r['days']:
        d = dt.date.fromisoformat(x['date'])
        ev = ' '.join(f'{k}={v}' for k, v in sorted(x['counts'].items()))
        meas = f"{x['measured']:>6.1f}" if x['rule'] else ''
        print(f"{x['date']:<11}{d:%a} {x['hours']:>6.1f}{meas:>6}  {x['span']:<12} {ev}"
              + (f"  ({x['rule']})" if x['rule'] else ''))
        if notes and x['notes']:
            print(f"{'':<23}{x['notes'][:160]}")
        week += x['hours']
        if d.weekday() == 6 or x is r['days'][-1]:
            print(f"{'':<11}{'wk':<4}{week:>6.1f}")
            week = 0.0
    print(f"\ntotal {r['total']:.1f}h")


def cmd_draft(a):
    r = build(a)
    if a.json:
        json.dump(r, open(a.json, 'w'), indent=1)
    print_draft(r, notes=not a.no_notes)


# ── Harvest ─────────────────────────────────────────────────────────────────

def harvest_config():
    cfg = {}
    if os.path.exists(HARVEST_ENV):
        for line in open(HARVEST_ENV):
            k, sep, v = line.strip().partition('=')
            if sep and not k.startswith('#'):
                cfg[k.strip().removeprefix('export ')] = v.strip().strip('"\'')
    cfg.update({k: v for k, v in os.environ.items() if k.startswith('HARVEST_')})
    missing = [k for k in ('HARVEST_ACCOUNT_ID', 'HARVEST_TOKEN', 'HARVEST_PROJECT', 'HARVEST_TASK') if not cfg.get(k)]
    if missing:
        sys.exit(f"missing {', '.join(missing)} — set them in {HARVEST_ENV} (see the skill's SKILL.md)")
    return cfg


def harvest(cfg, method, path, body=None):
    req = urllib.request.Request(
        'https://api.harvestapp.com/v2' + path, method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f"Bearer {cfg['HARVEST_TOKEN']}", 'Harvest-Account-Id': cfg['HARVEST_ACCOUNT_ID'],
                 'User-Agent': 'dotai-timesheet (andre.dreyer@rockofeye.ai)', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f'Harvest {method} {path} → {e.code}: {e.read().decode()[:400]}')


def harvest_pages(cfg, path, key):
    out, url = [], path
    while url:
        r = harvest(cfg, 'GET', url)
        out += r[key]
        nxt = (r.get('links') or {}).get('next')
        url = nxt.split('/v2', 1)[1] if nxt else None
    return out


def resolve_assignment(cfg):
    """Accept project/task as an id or an exact name (case-insensitive)."""
    want_p, want_t = cfg['HARVEST_PROJECT'].lower(), cfg['HARVEST_TASK'].lower()
    for pa in harvest_pages(cfg, '/users/me/project_assignments?per_page=100', 'project_assignments'):
        p = pa['project']
        if want_p in (str(p['id']), p['name'].lower(), (p.get('code') or '').lower()):
            for ta in pa['task_assignments']:
                t = ta['task']
                if want_t in (str(t['id']), t['name'].lower()):
                    return p, t
            sys.exit(f"task {cfg['HARVEST_TASK']!r} not assigned on project {p['name']!r}: "
                     f"{[ta['task']['name'] for ta in pa['task_assignments']]}")
    sys.exit(f"project {cfg['HARVEST_PROJECT']!r} not among your Harvest project assignments")


def cmd_push(a):
    r = build(a)
    cfg = harvest_config()
    me = harvest(cfg, 'GET', '/users/me')
    project, task = resolve_assignment(cfg)
    first, last = r['days'][0]['date'], r['days'][-1]['date']
    existing = collections.defaultdict(list)
    for e in harvest_pages(cfg, f"/time_entries?user_id={me['id']}&project_id={project['id']}"
                                f"&from={first}&to={last}&per_page=100", 'time_entries'):
        if e['task']['id'] == task['id']:
            existing[e['spent_date']].append(e)

    print(f"Harvest: {me['first_name']} {me['last_name']} · {project['name']} / {task['name']}")
    plan = []
    for x in r['days']:
        ref = f"{REF_PREFIX}:{x['date']}"
        mine = [e for e in existing[x['date']] if (e.get('external_reference') or {}).get('id') == ref]
        other = [e for e in existing[x['date']] if e not in mine]
        if other:
            plan.append(('skip', x, None, f"{len(other)} entry(ies) not made by this tool — left alone"))
        elif mine and any(e['is_locked'] for e in mine):
            plan.append(('skip', x, None, f"locked: {mine[0].get('locked_reason')}"))
        elif mine and x['hours'] == 0:
            plan.append(('delete', x, mine[0], f"{mine[0]['hours']}h → 0"))
        elif mine and (mine[0]['hours'] != x['hours'] or (mine[0]['notes'] or '') != x['notes']):
            plan.append(('update', x, mine[0], f"{mine[0]['hours']}h → {x['hours']}h"
                         if mine[0]['hours'] != x['hours'] else f"{x['hours']}h, notes only"))
        elif mine:
            plan.append(('same', x, mine[0], ''))
        elif x['hours']:
            plan.append(('create', x, None, f"{x['hours']}h"))

    for op, x, _, why in plan:
        if op != 'same':
            print(f"  {op:<7}{x['date']}  {why}")
    billed = sum(x['hours'] for op, x, _, _ in plan if op in ('create', 'update', 'same'))
    print(f"\nthis tool's entries after push: {billed:.1f}h  (draft total {r['total']:.1f}h)")
    if not a.apply:
        print('dry run — re-run with --apply to write to Harvest')
        return

    for op, x, e, _ in plan:
        body = {'hours': x['hours'], 'notes': x['notes']}
        if op == 'create':
            body.update(project_id=project['id'], task_id=task['id'], spent_date=x['date'],
                        external_reference={'id': f"{REF_PREFIX}:{x['date']}", 'group_id': f"{REF_PREFIX}:{r['month']}",
                                            'permalink': 'https://github.com/dr3dr3/dotai/tree/main/skills/timesheet'})
            made = harvest(cfg, 'POST', '/time_entries', body)
            if (made.get('external_reference') or {}).get('id') != body['external_reference']['id']:
                sys.exit(f"Harvest dropped external_reference on entry {made.get('id')} — stopping, "
                         'because re-runs would duplicate entries')
        elif op == 'update':
            harvest(cfg, 'PATCH', f"/time_entries/{e['id']}", body)
        elif op == 'delete':
            harvest(cfg, 'DELETE', f"/time_entries/{e['id']}")
    print('applied')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('archive')
    p.add_argument('--quiet', action='store_true')
    p.set_defaults(fn=cmd_archive)
    for name, fn in (('draft', cmd_draft), ('push', cmd_push)):
        p = sub.add_parser(name)
        p.add_argument('month', help='YYYY-MM')
        p.add_argument('--tz', default=os.environ.get('TIMESHEET_TZ', 'Australia/Brisbane'))
        p.add_argument('--gap-fill', type=int, default=30, help='bridge gaps up to this many minutes')
        p.add_argument('--min-day', type=float, default=1.0, help='days measuring less are not logged')
        p.add_argument('--max-day', type=float, default=14.0, help='cap on hours logged for one day')
        p.add_argument('--sources', default='claude,commit,pr,meeting')
        p.add_argument('--meetings', help='JSON list of {start,end,title} (from Google Calendar)')
        p.add_argument('--org', default='rock-of-eye', help='only count GitHub activity in this org')
        p.add_argument('--user', default='dr3dr3')
        p.add_argument('--refresh', action='store_true', help='ignore the GitHub cache')
        p.set_defaults(fn=fn)
        if name == 'draft':
            p.add_argument('--json', help='also write the draft here')
            p.add_argument('--no-notes', action='store_true')
        else:
            p.add_argument('--apply', action='store_true', help='write to Harvest (default: dry run)')
    a = ap.parse_args()
    a.fn(a)


if __name__ == '__main__':
    main()
