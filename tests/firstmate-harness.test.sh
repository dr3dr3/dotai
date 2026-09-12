#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../scripts/firstmate-harness.sh
source "$ROOT/scripts/firstmate-harness.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_eq() {
  local got="$1" want="$2" label="$3"
  [[ "$got" == "$want" ]] || fail "$label: got '$got' want '$want'"
}

assert_file() {
  local path="$1" want="$2"
  [[ -f "$path" ]] || fail "missing $path"
  assert_eq "$(tr -d '[:space:]' <"$path")" "$want" "$path"
}

HOME1="$TMP/home-empty"
mkdir -p "$HOME1"
unset FIRSTMATE_HARNESS
got="$(fm_harness_choose "$HOME1")"
assert_eq "$got" "claude" "non-tty empty home defaults to claude"
assert_file "$HOME1/config/captain-harness" "claude"
assert_file "$HOME1/config/crew-harness" "claude"
assert_file "$HOME1/config/secondmate-harness" "claude"

HOME2="$TMP/home-existing"
mkdir -p "$HOME2/config"
printf 'codex\n' >"$HOME2/config/crew-harness"
unset FIRSTMATE_HARNESS
got="$(fm_harness_choose "$HOME2")"
assert_eq "$got" "codex" "non-tty keeps existing crew pin"
assert_eq "$(cat "$HOME2/config/captain-harness" 2>/dev/null || true)" "" "non-tty keep does not invent captain pin"

HOME3="$TMP/home-env"
mkdir -p "$HOME3/config"
printf 'claude\n' >"$HOME3/config/crew-harness"
FIRSTMATE_HARNESS=codex
got="$(fm_harness_choose "$HOME3")"
assert_eq "$got" "codex" "FIRSTMATE_HARNESS overwrites"
assert_file "$HOME3/config/captain-harness" "codex"
assert_file "$HOME3/config/crew-harness" "codex"
assert_file "$HOME3/config/secondmate-harness" "codex"
unset FIRSTMATE_HARNESS

if FIRSTMATE_HARNESS=pi fm_harness_choose "$TMP/home-bad" >/dev/null 2>"$TMP/err"; then
  fail "invalid FIRSTMATE_HARNESS should fail"
fi
grep -q 'claude or codex' "$TMP/err" || fail "invalid env should name the allowed values"

assert_eq "$(fm_harness_normalize 2)" "codex" "prompt 2 is codex"
assert_eq "$(fm_harness_normalize Claude-Code)" "claude" "claude-code alias"

HOME4="$TMP/home-current"
mkdir -p "$HOME4/config"
printf 'codex\n' >"$HOME4/config/captain-harness"
printf 'claude\n' >"$HOME4/config/crew-harness"
assert_eq "$(fm_harness_current "$HOME4")" "codex" "captain pin wins over crew"

printf 'ok\n'
