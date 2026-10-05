#!/bin/sh
set -eu
printf 'allowed\n' > /tmp/probe-output/result
if cat /tmp/probe-denied/secret >/dev/null 2>&1; then
  echo 'FAIL: denied read succeeded'; exit 1
fi
if (printf forbidden > /tmp/probe-denied/write) 2>/dev/null; then
  echo 'FAIL: denied write succeeded'; exit 1
fi
if [ "${ROE_PROBE_TOKEN+x}" = x ]; then
  echo 'FAIL: fixture environment variable survived'; exit 1
fi
if /bin/sh -c 'cat /tmp/probe-denied/secret' >/dev/null 2>&1; then
  echo 'FAIL: child process escaped denied read'; exit 1
fi
echo 'PASS: restricted startup, output write, denied fixture access, child inheritance, environment filtering'
echo 'NOT TESTED: external network allow/deny, live Unix socket mediation, agent execution, restore'
