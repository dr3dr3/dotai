#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL="$ROOT/scripts/firstmate-permission-note.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export FM_HOME="$TMP/fm-home"
export ROE_FIRSTMATE_PERMISSION_LEDGER="$FM_HOME/data/permission-needs.jsonl"
export ROE_FIRSTMATE_SANDBOX_MODE_FILE="$TMP/sandbox-mode"
export ROE_FIRSTMATE_ROLE=captain
printf 'off\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"

bash "$CONTROL" \
  --boundary credential \
  --access read \
  --resource terraform-cli-credentials \
  --reason "Queue an explicitly approved remote plan" \
  --evidence successful-off-mode >"$TMP/output"

grep -F "no permission was granted" "$TMP/output" >/dev/null
[[ "$(wc -l <"$ROE_FIRSTMATE_PERMISSION_LEDGER")" -eq 1 ]]
[[ "$(stat -c '%a' "$ROE_FIRSTMATE_PERMISSION_LEDGER")" == 600 ]]

python3 - "$ROE_FIRSTMATE_PERMISSION_LEDGER" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    record = json.load(stream)

assert record["schema"] == "roe-firstmate-permission-need.v1"
assert record["role"] == "captain"
assert record["boundary"] == "credential"
assert record["access"] == "read"
assert record["resource"] == "terraform-cli-credentials"
assert record["evidence"] == "successful-off-mode"
assert record["sandbox_mode"] == "off"
assert record["disposition"] == "captured"
PY

if bash "$CONTROL" \
  --boundary credential \
  --access grant-everything \
  --resource terraform \
  --reason invalid >"$TMP/invalid" 2>&1; then
  printf 'expected invalid access to be refused\n' >&2
  exit 1
fi
grep -F "invalid --access" "$TMP/invalid" >/dev/null
[[ "$(wc -l <"$ROE_FIRSTMATE_PERMISSION_LEDGER")" -eq 1 ]]

if bash "$CONTROL" \
  --boundary credential \
  --access read \
  --resource 'token=github_pat_not-a-real-token' \
  --reason invalid >"$TMP/secret" 2>&1; then
  printf 'expected likely secret text to be refused\n' >&2
  exit 1
fi
grep -F "looks like a secret" "$TMP/secret" >/dev/null
[[ "$(wc -l <"$ROE_FIRSTMATE_PERMISSION_LEDGER")" -eq 1 ]]

printf 'ok - permission needs are private structured evidence, not grants\n'
