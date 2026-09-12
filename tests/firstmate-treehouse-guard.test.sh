#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/treehouse-firstmate-guard.sh"
TMP="$(mktemp -d /workspace/repos/.firstmate-guard-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

git -C "$TMP" init -q
git -C "$TMP" config user.email test@example.invalid
git -C "$TMP" config user.name "Firstmate guard test"
touch "$TMP/README.md"
git -C "$TMP" add README.md
git -C "$TMP" commit -qm init

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
export ROE_FIRSTMATE_MAX_SLOTS=4
export ROE_FIRSTMATE_MAX_ACTIVE_TASKS=2
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
assert_fails_with "outside the in-project pool" bash -c "cd '$TMP' && '$GUARD' get"
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
