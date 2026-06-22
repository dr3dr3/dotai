#!/usr/bin/env python3
"""Patch MemPalace's pgvector backend to strip NUL (0x00) bytes before insert.

Why: ChromaDB silently tolerated NUL bytes in drawer text/metadata, but
PostgreSQL text columns and jsonb reject them ("text fields cannot contain
NUL (0x00) bytes"). Some Claude Code conversation transcripts contain NUL
bytes (from binary-ish tool output), so `mempalace mine --mode convos` crashes
against the pgvector backend. mempalace 3.4.1 (latest) does not sanitise.

This idempotent patch rewrites `upsert_rows` in backends/pgvector.py to strip
NUL from the `document` text and the `\\u0000` escape from the dumped JSON
metadata. setup.sh re-applies it after every `uv tool install`, so it survives
devcontainer rebuilds. Remove once fixed upstream.
"""
import sys

MARKER = "# ROE-NUL-PATCH"
ANCHORS = {
    '                row["document"],\n':
        '                (row["document"].replace("\\x00", "") if isinstance(row.get("document"), str) else row["document"]),  # ROE-NUL-PATCH\n',
    '                _json_dumps(row.get("metadata")),\n':
        '                _json_dumps(row.get("metadata")).replace("\\\\u0000", ""),  # ROE-NUL-PATCH\n',
}


def main() -> int:
    try:
        import mempalace.backends.pgvector as pg
    except Exception as e:  # pragma: no cover
        print(f"  [nul-patch] cannot import pgvector backend ({e}); skipping")
        return 0  # pgvector extra not installed — nothing to patch

    path = pg.__file__
    src = open(path, encoding="utf-8").read()

    if MARKER in src:
        print("  [nul-patch] already applied")
        return 0

    missing = [a for a in ANCHORS if a not in src]
    if missing:
        print("  [nul-patch] ERROR: expected anchor(s) not found — mempalace "
              "internals changed; review patch-pgvector-nul.py", file=sys.stderr)
        return 1

    for anchor, repl in ANCHORS.items():
        src = src.replace(anchor, repl, 1)

    open(path, "w", encoding="utf-8").write(src)
    print(f"  [nul-patch] applied to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
