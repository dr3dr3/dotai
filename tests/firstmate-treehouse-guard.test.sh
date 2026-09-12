#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/treehouse-firstmate-guard.sh"
TMP="$(mktemp -d /workspace/repos/.firstmate-guard-test.XXXXXX)"
FIRSTMATE_TMP="$(mktemp -d /tmp/firstmate-home-guard-test.XXXXXX)"
trap 'rm -rf "$TMP" "$FIRSTMATE_TMP" "$FIRSTMATE_TMP-secondmates"' EXIT

git -C "$TMP" init -q
git -C "$TMP" config user.email test@example.invalid
git -C "$TMP" config user.name "Firstmate guard test"
touch "$TMP/README.md"
git -C "$TMP" add README.md
git -C "$TMP" commit -qm init

git -C "$FIRSTMATE_TMP" init -q
git -C "$FIRSTMATE_TMP" config user.email test@example.invalid
git -C "$FIRSTMATE_TMP" config user.name "Firstmate guard test"
touch "$FIRSTMATE_TMP/README.md"
git -C "$FIRSTMATE_TMP" add README.md
git -C "$FIRSTMATE_TMP" commit -qm init

STATUS_FILE="$TMP/status.json"
FAKE="$TMP/treehouse-real"
cat >"$FAKE" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  echo v2.3.0
elif [[ "${1:-}" == status && "${2:-}" == --json ]]; then
  cat "$FAKE_STATUS_FILE"
else
  printf '%s\n' "$*" >"$FAKE_CALL_FILE"
fi
SH
chmod 0755 "$FAKE"

export ROE_TREEHOUSE_REAL="$FAKE"
export ROE_FIRSTMATE_PROJECT_ROOT=/workspace/repos
export ROE_FIRSTMATE_ROOT="$FIRSTMATE_TMP"
export ROE_FIRSTMATE_SECOND_MATE_POOL_ROOT="$FIRSTMATE_TMP-secondmates"
export ROE_FIRSTMATE_MAX_SLOTS=4
export ROE_FIRSTMATE_MAX_ACTIVE_TASKS=2
export ROE_FIRSTMATE_MAX_SECOND_MATES=4
export FAKE_STATUS_FILE="$STATUS_FILE"
export FAKE_CALL_FILE="$TMP/call"

(
  cd /workspace
  "$GUARD" get --help
)
[[ "$(cat "$FAKE_CALL_FILE")" == "get --help" ]]

assert_fails_with() {
  local expected="$1"
  shift
  local output
  if output="$("$@" 2>&1)"; then
    printf 'expected command to fail: %s\n' "$*" >&2
    exit 1
  fi
  grep -F "$expected" <<<"$output" >/dev/null || {
    printf 'expected failure containing %q, got:\n%s\n' "$expected" "$output" >&2
    exit 1
  }
}

printf '[]\n' >"$STATUS_FILE"
(
  cd "$TMP"
  "$GUARD" get
) 2>"$TMP/no-fetch-warning"
[[ "$(cat "$FAKE_CALL_FILE")" == "get --no-fetch" ]]
grep -F "origin fetch skipped" "$TMP/no-fetch-warning" >/dev/null

(
  cd "$TMP"
  ROE_FIRSTMATE_TREEHOUSE_FETCH=1 "$GUARD" get
)
[[ "$(cat "$FAKE_CALL_FILE")" == get ]]

printf '[]\n' >"$STATUS_FILE"
(
  cd "$FIRSTMATE_TMP"
  "$GUARD" get --lease --lease-holder otel
) 2>"$TMP/secondmate-no-fetch-warning"
[[ "$(cat "$FAKE_CALL_FILE")" == "get --lease --lease-holder otel --no-fetch" ]]
grep -F "origin fetch skipped" "$TMP/secondmate-no-fetch-warning" >/dev/null

assert_fails_with "permits only durable second-mate leases" \
  bash -c "cd '$FIRSTMATE_TMP' && '$GUARD' get"
assert_fails_with "second-mate lease holder must match" \
  bash -c "cd '$FIRSTMATE_TMP' && '$GUARD' get --lease"
assert_fails_with "second-mate lease holder must match" \
  bash -c "cd '$FIRSTMATE_TMP' && '$GUARD' get --lease --lease-holder 'Bad Mate'"
assert_fails_with "durable leases are reserved for second-mate homes" \
  bash -c "cd '$TMP' && '$GUARD' get --lease --lease-holder otel"

mkdir -p \
  "$FIRSTMATE_TMP-secondmates/firstmate-pool/1/firstmate" \
  "$FIRSTMATE_TMP-secondmates/firstmate-pool/2/firstmate" \
  "$FIRSTMATE_TMP-secondmates/firstmate-pool/3/firstmate" \
  "$FIRSTMATE_TMP-secondmates/firstmate-pool/4/firstmate"
cat >"$STATUS_FILE" <<JSON
[
  {"path":"$FIRSTMATE_TMP-secondmates/firstmate-pool/1/firstmate","status":"leased"},
  {"path":"$FIRSTMATE_TMP-secondmates/firstmate-pool/2/firstmate","status":"leased"},
  {"path":"$FIRSTMATE_TMP-secondmates/firstmate-pool/3/firstmate","status":"leased"},
  {"path":"$FIRSTMATE_TMP-secondmates/firstmate-pool/4/firstmate","status":"leased"}
]
JSON
assert_fails_with "persistent second-mate limit reached" \
  bash -c "cd '$FIRSTMATE_TMP' && '$GUARD' get --lease --lease-holder config"

mkdir -p "$TMP/.treehouse/treehouse/1/repo"
cat >"$STATUS_FILE" <<JSON
[
  {
    "name": "1",
    "path": "$TMP/.treehouse/treehouse/1/repo",
    "status": "in use",
    "lease_id": "",
    "lease_holder": "",
    "leased_at": null,
    "processes": [{"pid": 1, "name": "agent"}]
  },
  {
    "name": "2",
    "path": "$TMP/.treehouse/treehouse/2/repo",
    "status": "leased",
    "lease_id": "lease",
    "lease_holder": "task",
    "leased_at": "2026-09-06T00:00:00Z",
    "processes": []
  }
]
JSON
mkdir -p "$TMP/.treehouse/treehouse/2/repo"
assert_fails_with "active/unavailable slot limit reached" bash -c "cd '$TMP' && '$GUARD' get"

cat >"$STATUS_FILE" <<JSON
[
  {
    "name": "primary",
    "path": "$TMP",
    "status": "available",
    "lease_id": "",
    "lease_holder": "",
    "leased_at": null,
    "processes": []
  }
]
JSON
assert_fails_with "contains the primary checkout" bash -c "cd '$TMP' && '$GUARD' get"

outside="$TMP/../outside-slot"
mkdir -p "$outside"
cat >"$STATUS_FILE" <<JSON
[
  {
    "name": "outside",
    "path": "$outside",
    "status": "available",
    "lease_id": "",
    "lease_holder": "",
    "leased_at": null,
    "processes": []
  }
]
JSON
assert_fails_with "outside the guarded pool" bash -c "cd '$TMP' && '$GUARD' get"
rm -rf "$outside"

slot="$TMP/.treehouse/treehouse/1/repo"
ln -s "$TMP" "$slot/vendor"
cat >"$STATUS_FILE" <<JSON
[
  {
    "name": "1",
    "path": "$slot",
    "status": "available",
    "lease_id": "",
    "lease_holder": "",
    "leased_at": null,
    "processes": []
  }
]
JSON
assert_fails_with "shared vendor symlink" bash -c "cd '$TMP' && '$GUARD' get"

printf 'ok - Firstmate Treehouse guard fails closed\n'
