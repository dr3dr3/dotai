#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTROL="$ROOT/scripts/firstmate-sandbox-mode.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export ROE_FIRSTMATE_SANDBOX_MODE_FILE="$TMP/config/sandbox-mode"

status="$("$CONTROL" status)"
grep -F "Firstmate nono sandbox: ON" <<<"$status" >/dev/null
grep -F "(default; file absent)" <<<"$status" >/dev/null

"$CONTROL" off 2>"$TMP/off-output"
[[ "$(<"$ROE_FIRSTMATE_SANDBOX_MODE_FILE")" == off ]]
if permissions="$(stat -c '%a' "$ROE_FIRSTMATE_SANDBOX_MODE_FILE" 2>/dev/null)"; then
  :
else
  permissions="$(stat -f '%Lp' "$ROE_FIRSTMATE_SANDBOX_MODE_FILE")"
fi
[[ "$permissions" == 600 ]]
grep -F "full devcontainer access" "$TMP/off-output" >/dev/null
grep -F "Firstmate nono sandbox: OFF" < <("$CONTROL" status) >/dev/null

"$CONTROL" on >"$TMP/on-output"
[[ "$(<"$ROE_FIRSTMATE_SANDBOX_MODE_FILE")" == on ]]
grep -F "Firstmate nono sandbox: ON" "$TMP/on-output" >/dev/null

printf 'unexpected\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"
if "$CONTROL" status >"$TMP/invalid-output" 2>&1; then
  printf 'expected invalid sandbox mode to fail closed\n' >&2
  exit 1
fi
grep -F "refusing to guess" "$TMP/invalid-output" >/dev/null

printf 'ok - Firstmate sandbox mode defaults on and toggles explicitly\n'
