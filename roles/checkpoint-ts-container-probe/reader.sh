#!/bin/sh
set -eu
test "$(stat -c %a /state)" = 711
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test "$(stat -c %u:%g:%a /state/pilot/continuity.sqlite3)" = 1000:1000:600
printf 'CHECKPOINT_JSON='
/tmp/probe/lib/ld-linux-aarch64.so.1 --library-path /tmp/probe/lib \
  /tmp/probe/node /tmp/probe/continuity_cli.ts query \
  --db /state/pilot/continuity.sqlite3 \
  --thread 33333333-3333-4333-8333-333333333333
