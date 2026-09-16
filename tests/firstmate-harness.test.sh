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

HOME5="$TMP/home-pi"
mkdir -p "$HOME5/config"
FIRSTMATE_HARNESS=pi
got="$(fm_harness_choose "$HOME5")"
assert_eq "$got" "pi" "FIRSTMATE_HARNESS=pi is accepted"
assert_file "$HOME5/config/captain-harness" "pi"
assert_file "$HOME5/config/crew-harness" "pi"
assert_file "$HOME5/config/secondmate-harness" "pi"
unset FIRSTMATE_HARNESS
got="$(fm_harness_choose "$HOME5")"
assert_eq "$got" "pi" "non-tty keeps an existing pi pin"

if FIRSTMATE_HARNESS=cursor fm_harness_choose "$TMP/home-bad" >/dev/null 2>"$TMP/err"; then
  fail "invalid FIRSTMATE_HARNESS should fail"
fi
grep -q 'claude, codex or pi' "$TMP/err" || fail "invalid env should name the allowed values"

assert_eq "$(fm_harness_normalize 2)" "codex" "prompt 2 is codex"
assert_eq "$(fm_harness_normalize 3)" "pi" "prompt 3 is pi"
assert_eq "$(fm_harness_normalize Pi)" "pi" "pi is case-insensitive"
assert_eq "$(fm_harness_normalize Claude-Code)" "claude" "claude-code alias"

HOME4="$TMP/home-current"
mkdir -p "$HOME4/config"
printf 'codex\n' >"$HOME4/config/captain-harness"
printf 'claude\n' >"$HOME4/config/crew-harness"
assert_eq "$(fm_harness_current "$HOME4")" "codex" "captain pin wins over crew"

printf 'ok\n'

# fm_count_active_tasks: only slot-occupying worker tasks count
HOME4="$TMP/home-count"
mkdir -p "$HOME4/state"
assert_eq "$(fm_count_active_tasks "$HOME4")" "0" "empty state counts zero"
printf 'endpoint_task_id=ship-a\nkind=ship\nmode=direct-PR\n' >"$HOME4/state/ship-a.meta"
printf 'endpoint_task_id=scout-b\nkind=scout\n' >"$HOME4/state/scout-b.meta"
printf 'endpoint_task_id=otel\nkind=secondmate\nmode=secondmate\n' >"$HOME4/state/otel.meta"
printf 'endpoint_task_id=reservation\nkind=ship\nworker_dispatch=none\n' >"$HOME4/state/reservation.meta"
printf 'not a meta\n' >"$HOME4/state/ship-a.status"
assert_eq "$(fm_count_active_tasks "$HOME4")" "2" "secondmate and worker_dispatch=none records are excluded"
