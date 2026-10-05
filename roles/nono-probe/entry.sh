#!/bin/sh
set -eu
mkdir -p /tmp/probe-output /tmp/probe-home /tmp/probe-denied /tmp/probe-work
printf 'inert fixture\n' > /tmp/probe-denied/secret
export HOME=/tmp/probe-home PATH=/usr/bin:/bin LANG=C ROE_PROBE_TOKEN=inert
/tmp/probe/nono --version
sed -n '/^Cap/p; /^Seccomp/p; /^NoNewPrivs/p' /proc/self/status
# Verify the negative-test fixture is accessible before applying nono.
cat /tmp/probe-denied/secret >/dev/null
printf baseline > /tmp/probe-denied/write
rm /tmp/probe-denied/write
cd /tmp/probe-work
exec timeout --signal=TERM --kill-after=5s 30s /tmp/probe/nono run --profile /tmp/probe/profile.json --allow-cwd --no-rollback -- /bin/sh /tmp/probe/check.sh
