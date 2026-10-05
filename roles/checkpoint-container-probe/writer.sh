#!/bin/sh
set -eu
test "$(stat -c %a /state)" = 733
test ! -e /state/pilot
mkdir -m 700 /state/pilot
export PYTHONHOME=/tmp/probe/tools/python PYTHONDONTWRITEBYTECODE=1
py() {
  /tmp/probe/tools/python/lib/ld-linux-aarch64.so.1 \
    --library-path /tmp/probe/tools/python/lib \
    /tmp/probe/tools/python/bin/python3 -S "$@"
}
db=/state/pilot/continuity.sqlite3
cli=/tmp/probe/tools/continuity.py
py "$cli" --db "$db" init
py "$cli" --db "$db" apply --producer fixture-launcher --kind launcher < /tmp/probe/register.json
py "$cli" --db "$db" apply --producer fixture-operator --kind operator < /tmp/probe/open.json
py "$cli" --db "$db" apply --producer fixture-session --kind session \
  --session 11111111-1111-4111-8111-111111111111 < /tmp/probe/checkpoint.json
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test "$(stat -c %u:%g:%a "$db")" = 1000:1000:600
printf '%s\n' 'PASS: synthetic checkpoint committed in private role directory'
