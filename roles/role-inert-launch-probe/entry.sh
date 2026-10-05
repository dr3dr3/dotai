#!/bin/sh
set -eu
test "$(stat -c %a /state)" = 733
test ! -e /state/pilot
mkdir -m 700 /state/pilot
mkdir -p /state/pilot/work /state/pilot/continuity /state/pilot/output \
  /state/pilot/tmp /state/pilot/home/.codex \
  /state/pilot/home/.config/roe-advisor \
  /state/pilot/home/.cache/roe-advisor \
  /state/pilot/home/.local/state/roe-advisor \
  /state/pilot/home/.local/state/nono /tmp/probe/context /tmp/probe/sibling \
  /tmp/supervisor
chmod 700 /state/pilot /state/pilot/continuity /state/pilot/output \
  /state/pilot/tmp /state/pilot/home/.codex
printf 'inert instructions\n' > /state/pilot/instructions.md
printf 'protected marker\n' > /state/pilot/home/.local/state/nono/marker
printf 'sibling marker\n' > /tmp/probe/sibling/marker
printf 'synthetic context\n' > /tmp/probe/context/test.md
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
cat /state/pilot/home/.local/state/nono/marker /tmp/probe/sibling/marker >/dev/null
printf unsandboxed > /state/pilot/home/root-write
rm /state/pilot/home/root-write
printf unsandboxed > /tmp/probe/context/write
rm /tmp/probe/context/write
printf '%s\n' 'PASS: unsandboxed positive controls and private role directory'
export HOME=/tmp/supervisor PATH=/usr/bin:/bin LANG=C ROE_PROBE_TOKEN=inert
/tmp/probe/nono --version
cd /state/pilot/work
exec /tmp/probe/nono run --profile /tmp/probe/profile.json --allow-cwd --no-rollback -- \
  /usr/bin/env HOME=/state/pilot/home CODEX_HOME=/state/pilot/home/.codex \
  XDG_CONFIG_HOME=/state/pilot/home/.config/roe-advisor \
  XDG_CACHE_HOME=/state/pilot/home/.cache/roe-advisor \
  XDG_STATE_HOME=/state/pilot/home/.local/state/roe-advisor \
  TMPDIR=/state/pilot/tmp /bin/sh /tmp/probe/check.sh
