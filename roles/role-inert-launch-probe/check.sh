#!/bin/sh
set -eu
cat /tmp/probe/context/test.md /state/pilot/instructions.md >/dev/null
for dir in /state/pilot/continuity /state/pilot/output /state/pilot/home/.codex \
  "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME" "$XDG_STATE_HOME" "$TMPDIR"; do
  printf allowed > "$dir/result"
done
for path in /state/pilot/home/.local/state/nono/marker /tmp/probe/sibling/marker; do
  if cat "$path" >/dev/null 2>&1; then
    printf '%s\n' 'FAIL: protected or sibling read allowed'
    exit 1
  fi
done
for path in /state/pilot/home/root-write /tmp/probe/context/write; do
  if (printf forbidden > "$path") 2>/dev/null; then
    printf '%s\n' 'FAIL: HOME or context write allowed'
    exit 1
  fi
done
if /bin/sh -c 'cat /tmp/probe/sibling/marker' >/dev/null 2>&1; then
  printf '%s\n' 'FAIL: child escaped filesystem restriction'
  exit 1
fi
test -z "${ROE_PROBE_TOKEN+x}"
printf '%s\n' 'PASS: intended reads and scoped writes; protected, sibling and child denials; filtered environment'
sed -n '/^Cap/p; /^Seccomp/p; /^NoNewPrivs/p' /proc/self/status
