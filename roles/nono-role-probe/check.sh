#!/bin/sh
set -eu
cat /tmp/context/reference/test.md /tmp/role/instructions.md /tmp/auth/auth.json >/dev/null
for dir in /tmp/role/output /tmp/role/home/.codex "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$TMPDIR"; do
 printf allowed > "$dir/result"
done
for path in /tmp/role/home/.local/state/nono/marker /tmp/other-role/marker; do
 if cat "$path" >/dev/null 2>&1; then echo 'FAIL: protected read allowed'; exit 1; fi
done
for path in /tmp/role/home/root-write /tmp/context/reference/write /tmp/auth/write; do
 if (printf forbidden > "$path") 2>/dev/null; then echo 'FAIL: out-of-scope write allowed'; exit 1; fi
done
if /bin/sh -c 'cat /tmp/other-role/marker' >/dev/null 2>&1; then echo 'FAIL: child escaped filesystem restriction'; exit 1; fi
echo 'PASS: candidate role reads/writes, protected-state denial, sibling denial and child inheritance'
version=$(/tmp/probe/tools/codex/codex --version)
[ "$version" = 'codex-cli 0.157.0' ] || { echo 'FAIL: unexpected Codex version'; exit 1; }
/tmp/probe/tools/codex/codex --help >/tmp/role/output/codex-help
/tmp/probe/tools/codex/codex app-server --help >/tmp/role/output/app-server-help
echo 'PASS: pinned native Codex version and help commands under candidate role profile'
echo 'NOT TESTED: interactive agent, provider auth/inference, real context, persistent state, native sockets or restore'
