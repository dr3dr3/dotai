#!/usr/bin/env bash
# =============================================================================
# mempalace — attach THIS env to the existing shared palace (no re-seed)
# =============================================================================
# The pgvector backend treats a local marker file (pgvector_backend.json) as
# "this palace is initialized". It lives in the container home, so a devcontainer
# rebuild loses it and `mempalace status` reports "No palace found" even though
# 24k drawers are sitting in Postgres.
#
# Per shared-state-plan.md: match the invariants, write the marker, do NOT run
# seed.sh (that would re-mine everything). `_write_marker()` writes ONLY this
# local file — no DB write, so it cannot fork or clobber the shared palace.
#
#   bash /workspace/.ai/dotai/mempalace/attach.sh
# =============================================================================
set -euo pipefail

CFG="/workspace/.ai/dotai/mempalace/state/config.json"

uv tool run --from 'mempalace[pgvector]' python - "$CFG" <<'PY'
import json, os, sys
from mempalace.backends.base import PalaceRef
from mempalace.backends.registry import get_backend
from mempalace.backends.pgvector import _PgVectorConfig

cfg  = json.load(open(sys.argv[1]))
path = cfg["palace_path"]
ns   = cfg["pgvector_namespace"]

backend = get_backend("pgvector")
palace  = PalaceRef(id=path, local_path=path)
pgcfg   = _PgVectorConfig(dsn=cfg["pgvector_dsn"], namespace=ns)

backend._write_marker(palace, pgcfg)

marker = os.path.join(path, "pgvector_backend.json")
data   = json.load(open(marker))
print(f"  • marker written: {marker}")
print(f"    table_prefix   {data['pgvector']['table_prefix']}")
print(f"    host/db        {data['pgvector']['host']}/{data['pgvector']['dbname']}")
PY

echo "→ mempalace status"
mempalace status 2>&1 | tail -25
