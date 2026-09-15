#!/usr/bin/env bash
# The Pi nono profiles mirror the claude/codex shape and grant exactly the Pi
# contract on top: the persisted ~/.ai/pi agent dir, and for workers the
# busy-state paths fm-spawn's state/<id>.pi-ext.ts needs (read the Firstmate
# clone for its imports and bin/fm-busy-event.sh, write FM_HOME/state).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/firstmate/nono" <<'PY'
import json
import sys
from pathlib import Path

nono = Path(sys.argv[1])
load = lambda name: json.loads((nono / f"roe-firstmate-{name}.json").read_text())
captain, worker = load("pi-captain"), load("pi-worker")
codex_captain, codex_worker = load("codex-captain"), load("codex-worker")

for name, profile in (("captain", captain), ("worker", worker)):
    assert profile["extends"] == "roe-firstmate-base", name
    assert profile["meta"]["name"] == f"roe-firstmate-pi-{name}", name
    assert "$HOME/.ai/pi" in profile["filesystem"]["allow"], name
    assert "groups" not in profile, f"{name}: Pi needs no harness-specific nono group"

# Captain: identical to the Codex captain apart from the harness state dir.
assert captain["workdir"] == {"access": "read"}
swap = lambda paths: sorted(p.replace("$HOME/.ai/codex", "$HOME/.ai/pi") for p in paths)
assert swap(codex_captain["filesystem"]["allow"]) == sorted(captain["filesystem"]["allow"])
assert captain["filesystem"]["read"] == codex_captain["filesystem"]["read"]

# Worker: one worktree, Pi state, and the busy-state contract - nothing else.
assert worker["workdir"] == {"access": "readwrite"}
assert sorted(worker["filesystem"]["allow"]) == ["$HOME/.ai/pi", "/workspace/.firstmate-home/state"]
assert worker["filesystem"]["read"] == ["/workspace/firstmate"]
assert "/workspace/.firstmate-home" not in worker["filesystem"]["allow"]
assert "$HOME/.ai/codex" not in worker["filesystem"]["allow"]
assert "$HOME/.ai/claude" not in worker["filesystem"]["allow"]
assert sorted(codex_worker["filesystem"]["allow"]) == ["$HOME/.ai/codex"], "codex worker shape changed; revisit this test"
PY

grep -F 'for harness in claude codex pi; do' "$ROOT/scripts/setup-firstmate.sh" >/dev/null
grep -F '3|pi) printf' "$ROOT/scripts/firstmate-harness.sh" >/dev/null
grep -F '  claude|codex|pi) ;;' "$ROOT/scripts/firstmate-harness-sandbox.sh" >/dev/null
grep -F 'launch=(pi)' "$ROOT/scripts/firstmate-local.sh" >/dev/null

printf 'ok - Firstmate Pi nono profiles grant the Pi contract and nothing adjacent\n'
