#!/bin/sh
set -eu
test "$(stat -c %u:%g:%a /state)" = 0:0:711
test "$(stat -c %u:%g:%a /state/pilot)" = 1000:1000:700
test ! -e /state/pilot/home/.codex/auth.json
test ! -e /state/pilot/home/.codex/config.toml
test -z "$(find /state/pilot/home -type f -o -type l)"
test "$(sha256sum /state/pilot/contract.json | cut -d ' ' -f 1)" = "$ROE_CONTRACT_SHA256"
mkdir -m 700 /tmp/supervisor /tmp/sibling
printf 'denied\n' > /tmp/sibling/marker
printf 'denied\n' > /state/pilot/home/.local/state/nono-marker
export HOME=/tmp/supervisor PATH=/usr/bin:/bin LANG=C
cd /state/pilot/work
exec /tmp/probe/nono run --profile /tmp/probe/profile.json --allow-cwd --no-rollback -- \
  /usr/bin/env HOME=/state/pilot/home CODEX_HOME=/state/pilot/home/.codex \
  XDG_CONFIG_HOME=/state/pilot/home/.config/roe-advisor \
  XDG_CACHE_HOME=/state/pilot/home/.cache/roe-advisor \
  XDG_STATE_HOME=/state/pilot/home/.local/state/roe-advisor \
  TMPDIR=/state/pilot/tmp /bin/sh /tmp/probe/start.sh
