#!/bin/sh
set -eu
export PYTHONHOME=/tmp/probe/tools/python PYTHONDONTWRITEBYTECODE=1
exec /tmp/probe/tools/python/lib/ld-linux-aarch64.so.1 --library-path /tmp/probe/tools/python/lib /tmp/probe/tools/python/bin/python3 -S /tmp/probe/tools/client.py
