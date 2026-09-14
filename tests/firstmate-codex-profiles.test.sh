#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

python3 - "$ROOT/firstmate/codex/fm-captain.config.toml" "$ROOT/firstmate/codex/fm-worker.config.toml" <<'PY'
import sys
import tomllib

captain = tomllib.load(open(sys.argv[1], "rb"))
worker = tomllib.load(open(sys.argv[2], "rb"))

for name, profile in (("captain", captain), ("worker", worker)):
    assert profile["hide_agent_reasoning"] is True, name
    assert profile["model_reasoning_summary"] == "none", name
    assert profile["model_verbosity"] == "low", name
    assert profile["personality"] == "pragmatic", name
    assert profile["file_opener"] == "cursor", name
    assert profile["projects"]["/workspace/repos/infrastructure"]["trust_level"] == "trusted", name
    assert profile["tui"]["animations"] is False, name
    assert profile["tui"]["notifications"] == ["agent-turn-complete", "approval-requested"], name
    assert profile["tui"]["notification_condition"] == "unfocused", name
    assert profile["tui"]["alternate_screen"] == "never", name

assert captain["model_reasoning_effort"] == "low"
assert worker["model_reasoning_effort"] == "high"
PY

grep -F 'configure_codex_profiles' "$ROOT/scripts/setup-firstmate.sh" >/dev/null
grep -F -- "--profile \"fm-\$ROLE\"" "$ROOT/scripts/firstmate-harness-sandbox.sh" >/dev/null
grep -F 'INFRASTRUCTURE_PROJECT_PATH' "$ROOT/scripts/setup-firstmate.sh" >/dev/null

# The Codex profiles trust /workspace/repos/infrastructure, which is only
# coherent while setup registers infrastructure as the checkout itself rather
# than through a backing clone. Assert the list, not the registration source
# line, so the check survives a refactor of how links are written.
direct_projects="$(
  # shellcheck disable=SC1090
  source <(sed -n '/^DIRECT_PROJECTS=(/,/)$/p' "$ROOT/scripts/setup-firstmate.sh")
  # shellcheck disable=SC2153
  printf '%s\n' "${DIRECT_PROJECTS[@]}"
)"
printf '%s\n' "$direct_projects" | grep -Fxq infrastructure

printf 'ok - Firstmate Codex profiles are quiet and role-specific\n'
