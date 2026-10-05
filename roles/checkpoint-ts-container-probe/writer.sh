#!/bin/sh
set -eu
test "$(stat -c %a /state)" = 733
test ! -e /state/pilot
mkdir -m 700 /state/pilot
db=/state/pilot/continuity.sqlite3
cli=/tmp/probe/continuity_cli.ts
node_cli() {
  /tmp/probe/lib/ld-linux-aarch64.so.1 --library-path /tmp/probe/lib \
    /tmp/probe/node "$cli" "$@" --db "$db"
}
node_cli init
node_cli apply --producer fixture-launcher --kind launcher < /tmp/probe/register.json
node_cli apply --producer fixture-operator --kind operator < /tmp/probe/open.json
node_cli apply --producer fixture-session --kind session \
  --session 11111111-1111-4111-8111-111111111111 < /tmp/probe/checkpoint.json
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test "$(stat -c %u:%g:%a "$db")" = 1000:1000:600
printf '%s\n' 'PASS: TypeScript checkpoint committed in private role directory'
