#!/bin/sh
set -eu
mkdir -p /tmp/probe-output /tmp/probe-home /tmp/probe-work
export HOME=/tmp/probe-home PATH=/usr/bin:/bin LANG=C
/tmp/probe/nono --version
sed -n '/^Cap/p; /^Seccomp/p; /^NoNewPrivs/p' /proc/self/status
cd /tmp/probe-work
exec /tmp/probe/network-probe
