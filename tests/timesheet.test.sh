#!/usr/bin/env bash
# The slot model and the evidence filter behind skills/timesheet — the parts an
# invoice depends on. No network: GitHub and Harvest are not touched.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TIMESHEET_HOME="$TMP/home" CLAUDE_PROJECTS="$TMP/projects"
mkdir -p "$CLAUDE_PROJECTS/-workspace" "$CLAUDE_PROJECTS/-workspace-repos-api--treehouse-x"

python3 - "$CLAUDE_PROJECTS" <<'PY'
import json, sys
root = sys.argv[1]
def msg(uuid, ts, text, **kw):
    d = {'type': 'user', 'uuid': uuid, 'timestamp': ts, 'origin': {'kind': 'human'},
         'permissionMode': 'auto', 'message': {'role': 'user', 'content': text}}
    d.update(kw)
    return json.dumps(d) + '\n'
# Brisbane is UTC+10: 2026-09-02T00:05Z is 10:05 local.
with open(f'{root}/-workspace/a.jsonl', 'w') as f:
    f.write(msg('u1', '2026-09-02T00:05:00Z', 'start'))            # slot 10:00
    f.write(msg('u2', '2026-09-02T00:50:00Z', 'continue'))         # slot 10:30
    f.write(msg('u3', '2026-09-02T01:40:00Z', 'after 30m gap'))    # slot 11:30 -> 11:00 bridged
    f.write(msg('u4', '2026-09-02T03:10:00Z', 'after 60m gap'))    # slot 13:00, 12:00-13:00 NOT bridged
    f.write(msg('x1', '2026-09-02T05:00:00Z', '<task-notification>done</task-notification>'))
    f.write(msg('x2', '2026-09-02T06:00:00Z', 'agent', permissionMode='bypassPermissions'))
    f.write(msg('x3', '2026-09-02T07:00:00Z', 'meta', isMeta=True))
with open(f'{root}/-workspace/b.jsonl', 'w') as f:                 # resumed session repeats u1
    f.write(msg('u1', '2026-09-02T00:05:00Z', 'start'))
with open(f'{root}/-workspace-repos-api--treehouse-x/c.jsonl', 'w') as f:
    f.write(msg('w1', '2026-09-03T00:00:00Z', 'crew worker'))
PY

S="$ROOT/skills/timesheet/scripts/timesheet.py"
python3 "$S" archive --quiet
python3 "$S" archive --quiet
[[ "$(wc -l <"$TIMESHEET_HOME/claude-prompts.jsonl")" -eq 4 ]] || { echo "ledger should hold 4 prompts"; exit 1; }
! grep -q 'start\|continue' "$TIMESHEET_HOME/claude-prompts.jsonl" || { echo "ledger must not keep prompt text"; exit 1; }

# Transcripts pruned: the ledger alone must still carry the month.
rm -rf "$CLAUDE_PROJECTS"/*
cat >"$TMP/meetings.json" <<'JSON'
[{"start": "2026-09-04T09:00:00+10:00", "end": "2026-09-04T10:00:00+10:00", "title": "Weekly with Mark"},
 {"start": "2026-09-05T09:00:00+10:00", "end": "2026-09-05T09:30:00+10:00", "title": "Quick sync"},
 {"start": "2026-09-06T06:00:00+10:00", "end": "2026-09-06T22:00:00+10:00", "title": "Offsite"}]
JSON
python3 "$S" draft 2026-09 --sources claude,meeting --meetings "$TMP/meetings.json" --json "$TMP/d.json" >/dev/null

python3 - "$TMP/d.json" "$S" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
days = {d['date']: d for d in r['days']}
assert days['2026-09-02']['hours'] == 2.5, days['2026-09-02']   # 10:00-12:00 + 13:00
assert days['2026-09-02']['span'] == '10:00–13:30', days['2026-09-02']
assert days['2026-09-03']['hours'] == 0, 'crew worktree prompts must not bill'
assert days['2026-09-04']['hours'] == 1.0 and 'Weekly with Mark' in days['2026-09-04']['notes']  # 1h is enough
assert days['2026-09-05']['measured'] == 0.5 and days['2026-09-05']['hours'] == 0, 'under 1h is not logged'
assert days['2026-09-05']['notes'] == ''
assert days['2026-09-06']['measured'] == 16.0 and days['2026-09-06']['hours'] == 14.0, days['2026-09-06']
assert days['2026-09-06']['notes'].startswith('[timesheet ✓ 16h measured, capped at 14h · 06:00–22:00 · 1 meeting]')
assert days['2026-09-02']['notes'].startswith('[timesheet ✓ 2.5h measured · 10:00–13:30 · 4 prompts]')
import importlib.util
spec = importlib.util.spec_from_file_location('ts', sys.argv[2]); ts = importlib.util.module_from_spec(spec); spec.loader.exec_module(ts)
assert ts.evidence_line(2, 2, '10:00–12:00', {'pr': 2, 'commit': 1}) == '[timesheet ✓ 2h measured · 10:00–12:00 · 1 commit, 2 PRs/issues]'
assert r['total'] == 17.5, r['total']
PY
echo "timesheet: ok"
