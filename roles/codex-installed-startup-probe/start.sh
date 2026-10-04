#!/bin/sh
set -eu
test "${ROE_PROBE_TOKEN+x}" = ""
test ! -e "$CODEX_HOME/auth.json"
if cat /tmp/sibling/marker >/dev/null 2>&1; then
  printf 'SIBLING_READ_ALLOWED\n' >&2
  exit 1
fi
if cat /state/pilot/home/.local/state/nono-marker >/dev/null 2>&1; then
  printf 'PROTECTED_READ_ALLOWED\n' >&2
  exit 1
fi
printf 'SANDBOX_DENIALS_OK\n'
sed -n '/^Cap/p; /^Seccomp/p; /^NoNewPrivs/p' /proc/self/status
printf '%s\n%s\n' \
  '{"id":1,"method":"initialize","params":{"clientInfo":{"name":"roe_installed_state_fixture","version":"1"}}}' \
  '{"method":"initialized"}' | /tmp/probe/codex app-server --listen stdio://
printf 'APP_SERVER_EXITED_CLEANLY\n'
