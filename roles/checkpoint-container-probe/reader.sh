#!/bin/sh
set -eu
test "$(stat -c %a /state)" = 711
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test "$(stat -c %u:%g:%a /state/pilot/continuity.sqlite3)" = 1000:1000:600
export PYTHONHOME=/tmp/probe/tools/python PYTHONDONTWRITEBYTECODE=1
printf 'CHECKPOINT_JSON='
/tmp/probe/tools/python/lib/ld-linux-aarch64.so.1 \
  --library-path /tmp/probe/tools/python/lib \
  /tmp/probe/tools/python/bin/python3 -S /tmp/probe/tools/continuity.py \
  --db /state/pilot/continuity.sqlite3 query \
  --thread 33333333-3333-4333-8333-333333333333
