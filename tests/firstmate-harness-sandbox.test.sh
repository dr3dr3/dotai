#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WRAPPER="$ROOT/scripts/firstmate-harness-sandbox.sh"
TMP="$(mktemp -d /workspace/repos/rock-of-eye-api/.treehouse/.firstmate-nono-wrapper-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/real" "$TMP/profiles" "$TMP/worker-guard-bin"
touch "$TMP/profiles/roe-firstmate-codex-captain.json"
touch "$TMP/profiles/roe-firstmate-codex-worker.json"
touch "$TMP/worker-guard-bin/terraform" "$TMP/worker-guard-bin/tofu"
chmod 0755 "$TMP/worker-guard-bin/terraform" "$TMP/worker-guard-bin/tofu"

cat >"$TMP/real/codex" <<'SH'
#!/usr/bin/env bash
printf 'real:%s\n' "$*" >"$FAKE_REAL_CALL"
printf 'role=%s path=%s\n' "${ROE_FIRSTMATE_ROLE-unset}" "$PATH" >"$FAKE_REAL_ENV"
SH
chmod 0755 "$TMP/real/codex"

cat >"$TMP/fake-nono" <<'SH'
#!/usr/bin/env bash
if [[ "${1:-}" == --version ]]; then
  echo "nono 0.76.0"
  exit 0
fi
printf 'nono:%s\n' "$*" >"$FAKE_NONO_CALL"
printf 'captain=%s required=%s role=%s\n' \
  "${ROE_FIRSTMATE_CAPTAIN-unset}" \
  "${ROE_FIRSTMATE_SANDBOX_REQUIRED-unset}" \
  "${ROE_FIRSTMATE_ROLE-unset}" >>"$FAKE_NONO_CALL"
printf 'path=%s\n' "$PATH" >>"$FAKE_NONO_CALL"
SH
chmod 0755 "$TMP/fake-nono"
ln -s "$WRAPPER" "$TMP/bin/codex"

export ROE_FIRSTMATE_NONO="$TMP/fake-nono"
export ROE_FIRSTMATE_REAL_HARNESS_DIR="$TMP/real"
export ROE_FIRSTMATE_NONO_PROFILE_DIR="$TMP/profiles"
export ROE_FIRSTMATE_SANDBOX_MODE_FILE="$TMP/sandbox-mode"
export ROE_FIRSTMATE_WORKER_GUARD_BIN="$TMP/worker-guard-bin"
export FAKE_NONO_CALL="$TMP/nono-call"
export FAKE_REAL_CALL="$TMP/real-call"
export FAKE_REAL_ENV="$TMP/real-env"

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

(
  cd /workspace
  "$TMP/bin/codex" ordinary
)
[[ "$(cat "$FAKE_REAL_CALL")" == "real:ordinary" ]]
[[ ! -e "$FAKE_NONO_CALL" ]]

(
  cd /workspace
  ROE_FIRSTMATE_NONO="$TMP/missing-nono" "$TMP/bin/codex" ordinary-without-nono
)
[[ "$(cat "$FAKE_REAL_CALL")" == "real:ordinary-without-nono" ]]

assert_fails_with "outside a recognized captain or Treehouse path" \
  bash -c "cd /workspace && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 '$TMP/bin/codex' refused"

git -C "$TMP" init -q
git -C "$TMP" config user.email test@example.invalid
git -C "$TMP" config user.name "Firstmate nono test"
touch "$TMP/README.md"
git -C "$TMP" add README.md
git -C "$TMP" commit -qm init
SLOT="$TMP/slot"
git -C "$TMP" worktree add -qb sandbox-test "$SLOT"

assert_fails_with "refuses the Treehouse backing primary checkout" \
  bash -c "cd '$TMP' && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 '$TMP/bin/codex' refused"

printf 'off\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"
touch "$SLOT/.env"
(
  cd "$SLOT"
  ROE_FIRSTMATE_NONO="$TMP/missing-nono" "$TMP/bin/codex" unsandboxed-worker
) 2>"$TMP/off-warning"
[[ "$(cat "$FAKE_REAL_CALL")" == "real:--profile fm-worker --sandbox danger-full-access unsandboxed-worker" ]]
grep -F "role=worker path=$TMP/worker-guard-bin:" "$FAKE_REAL_ENV" >/dev/null
grep -F "Firstmate nono sandbox is OFF" "$TMP/off-warning" >/dev/null
rm "$SLOT/.env"
printf 'on\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"

assert_fails_with "pinned nono binary missing" \
  bash -c "cd '$SLOT' && ROE_FIRSTMATE_NONO='$TMP/missing-nono' '$TMP/bin/codex' refused"

touch "$SLOT/.env"
assert_fails_with "worker checkout contains a local environment file" \
  bash -c "cd '$SLOT' && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 '$TMP/bin/codex' refused"
rm "$SLOT/.env"
touch "$SLOT/.env.example"
(
  cd "$SLOT"
  ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$TMP/bin/codex" worker-brief
)
grep -F "nono:run --profile roe-firstmate-codex-worker --allow-cwd -- $TMP/real/codex --profile fm-worker --sandbox danger-full-access worker-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "captain=unset required=unset role=worker" "$FAKE_NONO_CALL" >/dev/null
grep -F "path=$TMP/worker-guard-bin:" "$FAKE_NONO_CALL" >/dev/null

(
  cd /workspace/firstmate
  ROE_FIRSTMATE_CAPTAIN=1 ROE_FIRSTMATE_SANDBOX_REQUIRED=1 \
    "$TMP/bin/codex" captain-brief
)
grep -F "nono:run --profile roe-firstmate-codex-captain --allow-cwd -- $TMP/real/codex --profile fm-captain --sandbox danger-full-access captain-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "captain=unset required=unset role=captain" "$FAKE_NONO_CALL" >/dev/null

printf 'ok - Firstmate harness launches fail closed through nono\n'
