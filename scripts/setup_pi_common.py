"""JSON helpers shared by setup-pi.py and pi-ollama-models.py.

Pi accepts // and /* */ comments in models.json (docs/custom-provider.md), and
the committed sandbox/profiles/config/pi/models.json uses them, so both scripts
need a comment-tolerant reader. Writes are atomic so a crash mid-write never
leaves Pi with a half-written config.
"""
import json
import os
import tempfile
from pathlib import Path


def strip_json_comments(text):
    out, i, n = [], 0, len(text)
    in_string = False
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
            continue
        if text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_json(path, allow_comments=False):
    text = Path(path).read_text(encoding="utf-8-sig")
    if allow_comments:
        text = strip_json_comments(text)
    return json.loads(text)


def write_json_atomic(path, data, mode=0o644):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2)
            handle.write("\n")
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
