#!/bin/sh
set -eu
mkdir -p /tmp/supervisor /tmp/context/reference /tmp/context/explanation /tmp/context/plans \
 /tmp/role/work /tmp/role/output /tmp/role/tmp /tmp/role/home/.codex \
 /tmp/role/home/.config/roe-advisor /tmp/role/home/.cache/roe-advisor \
 /tmp/role/home/.local/state/roe-advisor /tmp/role/home/.local/state/nono \
 /tmp/other-role /tmp/auth
printf 'synthetic reference\n' > /tmp/context/reference/test.md
printf 'synthetic instructions\n' > /tmp/role/instructions.md
printf '{}\n' > /tmp/auth/auth.json
printf 'inert protected marker\n' > /tmp/role/home/.local/state/nono/marker
printf 'inert sibling marker\n' > /tmp/other-role/marker
# Positive controls: denied fixtures exist and are accessible before sandboxing.
cat /tmp/role/home/.local/state/nono/marker /tmp/other-role/marker >/dev/null
printf before > /tmp/role/home/root-write
rm /tmp/role/home/root-write
printf before > /tmp/context/reference/write
rm /tmp/context/reference/write
printf 'PASS: unsandboxed filesystem controls\n'
export HOME=/tmp/supervisor PATH=/usr/bin:/bin LANG=C
/tmp/probe/nono --version
sed -n '/^Cap/p; /^Seccomp/p; /^NoNewPrivs/p' /proc/self/status
cd /tmp/role/work
exec /tmp/probe/nono run --profile /tmp/probe/profile.json --allow-cwd --no-rollback -- \
 /usr/bin/env HOME=/tmp/role/home CODEX_HOME=/tmp/role/home/.codex \
 XDG_CONFIG_HOME=/tmp/role/home/.config/roe-advisor \
 XDG_CACHE_HOME=/tmp/role/home/.cache/roe-advisor \
 XDG_STATE_HOME=/tmp/role/home/.local/state/roe-advisor TMPDIR=/tmp/role/tmp \
 /bin/sh /tmp/probe/tools/check.sh
