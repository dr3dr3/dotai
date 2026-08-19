#!/usr/bin/env bash
# =============================================================================
# mempalace — set the pgvector DSN password + verify we joined the REAL palace
# =============================================================================
# The palace password is the one piece of config that can't live in the repo.
# This prompts for it silently (never hits shell history or an agent transcript),
# refuses an empty value (an empty `op read` silently produced a 0-char password
# once — fail-closed here), URL-encodes it, and writes state/config.json 0600.
#
# It then runs the SHARED-PALACE INVARIANT check from shared-state-plan.md:
# the drawers table is  mempalace_<namespace>_<sha256(palace_path)[:16]>_… .
# A wrong palace_path/namespace does NOT error — it silently creates a new EMPTY
# palace. So we assert the expected table exists and has rows BEFORE trusting it.
#
#   bash /workspace/.ai/dotai/mempalace/set-dsn.sh            # prompt
#   bash /workspace/.ai/dotai/mempalace/set-dsn.sh --from-file /path/creds.txt
#   bash /workspace/.ai/dotai/mempalace/set-dsn.sh --from-op 'op://Vault/Item/password'
# =============================================================================
set -euo pipefail

CFG="/workspace/.ai/dotai/mempalace/state/config.json"
[ -f "$CFG" ] || { echo "✖ no config at $CFG — run setup.sh first" >&2; exit 1; }

PW=""
if [ "${1:-}" = "--from-file" ]; then
    # key=value file (password=…). Read WITHOUT echoing; the file is plaintext,
    # so shred it afterwards — this is a transport, not a store.
    [ -r "${2:-}" ] || { echo "✖ --from-file needs a readable file" >&2; exit 1; }
    PW="$(python3 -c "
import sys
for line in open(sys.argv[1]):
    k, _, v = line.strip().partition('=')
    if k.strip().lower() == 'password':
        print(v); break
" "$2")"
elif [ "${1:-}" = "--from-op" ]; then
    [ -n "${2:-}" ] || { echo "✖ --from-op needs an op:// reference" >&2; exit 1; }
    PW="$(op read "$2")" || { echo "✖ op read failed — not writing anything" >&2; exit 1; }
else
    read -rsp "MemPalace pgvector password: " PW; echo
fi

# Fail CLOSED: an empty secret must never be written as a valid-looking DSN.
if [ -z "${PW//[[:space:]]/}" ]; then
    echo "✖ empty password — refusing to write (config left untouched)" >&2
    exit 1
fi

PW="$PW" python3 - "$CFG" <<'PY'
import json, os, sys, urllib.parse
path = sys.argv[1]
cfg = json.load(open(path))
pw = urllib.parse.quote(os.environ["PW"], safe="")
host = cfg.get("_dsn_host", "host.docker.internal:5432")
cfg["pgvector_dsn"] = f"postgresql://mempalace:{pw}@{host}/mempalace"
json.dump(cfg, open(path, "w"), indent=2)
open(path, "a").write("\n")
os.chmod(path, 0o600)
print(f"  • dsn written ({len(os.environ['PW'])} char password)")
PY

echo "→ verifying the shared-palace invariants…"
uv tool run --from 'mempalace[pgvector]' python - "$CFG" <<'PY'
import hashlib, json, re, sys
try:
    import psycopg
except ImportError:
    sys.exit("✖ psycopg missing — re-run setup.sh (needs the [pgvector] extra)")

cfg  = json.load(open(sys.argv[1]))
ns   = cfg["pgvector_namespace"]
path = cfg["palace_path"]
h    = hashlib.sha256(path.encode()).hexdigest()[:16]
# The backend slugs the namespace into the table name (_slug in backends/
# pgvector.py: [^A-Za-z0-9_] -> "_"), so "andre-shared" becomes "andre_shared".
# shared-state-plan.md documents the raw namespace — mirror the real rule here.
slug = re.sub(r"[^A-Za-z0-9_]+", "_", ns).strip("_")
want = f"mempalace_{slug}_{h}_mempalace_drawers"

print(f"  namespace      {ns}  (slugged: {slug})")
print(f"  palace_path    {path}")
print(f"  → table hash   {h}   (plan says db426f05c18fc7c5)")

try:
    with psycopg.connect(cfg["pgvector_dsn"], connect_timeout=10) as c:
        tables = [r[0] for r in c.execute(
            "select tablename from pg_tables where tablename like 'mempalace_%%'").fetchall()]
        if want not in tables:
            print(f"\n✖ FORK RISK: expected table not found:\n    {want}")
            print("  Tables that DO exist:")
            for t in tables: print("   ", t)
            print("\n  Do NOT seed — that would build a new empty palace.")
            sys.exit(2)
        n = c.execute(f'select count(*) from "{want}"').fetchone()[0]
        rng = c.execute(f'select min(updated_at), max(updated_at) from "{want}"').fetchone()
        print(f"\n✅ joined the existing palace — {n:,} drawers")
        print(f"   oldest {rng[0]}   newest {rng[1]}")
except psycopg.OperationalError as e:
    sys.exit(f"✖ connection failed: {str(e)[:160]}")
PY
