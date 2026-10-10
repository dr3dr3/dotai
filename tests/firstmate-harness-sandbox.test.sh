#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# ── hermetic root ────────────────────────────────────────────────────────────
# The harness decides roles from literal /workspace paths, and the captain-home
# resolver has fixed /workspace roots. Neither has, or may gain, an environment
# override: that would let a caller redirect the authority roots in production.
# So this suite runs a TEST-LOCAL COPY in which every root-anchored
# "/workspace/" is rewritten to a fresh temporary root, and only reads the
# production files. The copy is refused if any root-anchored /workspace path
# survives outside comments, so the suite cannot reach the live checkout, the
# live Firstmate home, /workspace/.treehouse or /workspace/repos.
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE FM_HOME NODE_OPTIONS
TMP="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/fm-sandbox-test.XXXXXX")" && pwd -P)"
trap 'rm -rf "$TMP"' EXIT
[[ "$TMP/" != /workspace/* ]] || {
  echo "refusing: temporary root $TMP is under /workspace" >&2
  exit 1
}
FAKEROOT="$TMP/root"
COPY="$TMP/dotai"
COPIED=(scripts/firstmate-harness-sandbox.sh scripts/firstmate-sandbox-mode.sh
  scripts/firstmate-captain-home.ts firstmate/pins.env)
mkdir -p "$COPY/scripts" "$COPY/firstmate"
for file in "${COPIED[@]}"; do
  sed "s#/workspace/#$FAKEROOT/#g" "$ROOT/$file" >"$COPY/$file"
  chmod --reference="$ROOT/$file" "$COPY/$file"
done
leaks="$(for file in "${COPIED[@]}"; do grep -vE '^[[:space:]]*(#|//|\*)' "$COPY/$file"; done \
  | grep -F /workspace | grep -vF '%/workspace}' || true)"
[[ -z "$leaks" ]] || {
  printf 'refusing: a /workspace path survived the test rewrite:\n%s\n' "$leaks" >&2
  exit 1
}
grep -qF "$FAKEROOT/firstmate/" "$COPY/scripts/firstmate-harness-sandbox.sh" \
  || { echo "refusing: the captain path was not rewritten" >&2; exit 1; }
WRAPPER="$COPY/scripts/firstmate-harness-sandbox.sh"

export HOME="$TMP/home"
mkdir -p "$HOME" "$TMP/bin" "$TMP/real" "$TMP/profiles" "$TMP/worker-guard-bin"
for profile in claude-captain claude-worker codex-captain codex-worker pi-captain pi-worker; do
  touch "$TMP/profiles/roe-firstmate-$profile.json"
done
touch "$TMP/worker-guard-bin/terraform" "$TMP/worker-guard-bin/tofu"
chmod 0755 "$TMP/worker-guard-bin/terraform" "$TMP/worker-guard-bin/tofu"

# A registered, initialised captain home and its runtime registry, inside the
# temporary root only.
CAPTAIN_DIR="$FAKEROOT/firstmate"
FM_HOME_DIR="$FAKEROOT/.firstmate-home"
REGISTRY="$FAKEROOT/.git/roe-runtime.json"
mkdir -p "$CAPTAIN_DIR" "$FAKEROOT/.git" "$FM_HOME_DIR/config" "$FM_HOME_DIR/data" "$FM_HOME_DIR/state"
register_home() { printf '{"version":1,"homes":["%s"]}\n' "$1" >"$REGISTRY"; }
register_home "$FM_HOME_DIR"

cat >"$TMP/real/codex" <<'SH'
#!/usr/bin/env bash
printf 'real:%s\n' "$*" >"$FAKE_REAL_CALL"
printf 'role=%s path=%s\n' "${ROE_FIRSTMATE_ROLE-unset}" "$PATH" >"$FAKE_REAL_ENV"
SH
chmod 0755 "$TMP/real/codex"
cp "$TMP/real/codex" "$TMP/real/pi"
cp "$TMP/real/codex" "$TMP/real/claude"
chmod 0755 "$TMP/real/pi" "$TMP/real/claude"

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
printf 'config_dir=%s\n' "${CLAUDE_CONFIG_DIR-unset}" >>"$FAKE_NONO_CALL"
printf 'fm_home=%s\n' "${FM_HOME-unset}" >>"$FAKE_NONO_CALL"
SH
chmod 0755 "$TMP/fake-nono"
ln -s "$WRAPPER" "$TMP/bin/claude"
ln -s "$WRAPPER" "$TMP/bin/codex"
ln -s "$WRAPPER" "$TMP/bin/pi"
ln -s "$WRAPPER" "$TMP/bin/cursor"

export ROE_FIRSTMATE_NONO="$TMP/fake-nono"
# Never let a launcher test reach a real fm-grant / vault: leases have their own suite.
export ROE_FIRSTMATE_AUTO_LEASES=0
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
  cd "$FAKEROOT"
  "$TMP/bin/codex" ordinary
)
[[ "$(cat "$FAKE_REAL_CALL")" == "real:ordinary" ]]
[[ ! -e "$FAKE_NONO_CALL" ]]

(
  cd "$FAKEROOT"
  ROE_FIRSTMATE_NONO="$TMP/missing-nono" "$TMP/bin/codex" ordinary-without-nono
)
[[ "$(cat "$FAKE_REAL_CALL")" == "real:ordinary-without-nono" ]]

assert_fails_with "must be invoked through the claude, codex or pi launcher link" "$TMP/bin/cursor"
assert_fails_with "sandbox-required launch is outside a recognized captain or Treehouse path" \
  bash -c "cd '$FAKEROOT' && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 '$TMP/bin/codex' refused"

# A Treehouse backing checkout (its .git is a directory) and a worker slot
# (a linked worktree, .git is a file), both under the temporary root.
BACKING="$FAKEROOT/repos/test-repo/.treehouse/firstmate-backing/test-repo"
mkdir -p "$BACKING"
git -C "$BACKING" init -q
git -C "$BACKING" config user.email test@example.invalid
git -C "$BACKING" config user.name "Firstmate nono test"
touch "$BACKING/README.md"
git -C "$BACKING" add README.md
git -C "$BACKING" commit -qm init
SLOT="$FAKEROOT/repos/test-repo/.treehouse/ws-test/1/workspace"
mkdir -p "$(dirname "$SLOT")"
git -C "$BACKING" worktree add -qb sandbox-test "$SLOT"

assert_fails_with "refuses the Treehouse backing primary checkout" \
  bash -c "cd '$BACKING' && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 '$TMP/bin/codex' refused"

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
grep -F "nono:run --profile roe-firstmate-codex-worker --allow-cwd --read $TMP/real -- $TMP/real/codex --profile fm-worker --sandbox danger-full-access worker-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "captain=unset required=unset role=worker" "$FAKE_NONO_CALL" >/dev/null
grep -F "path=$TMP/worker-guard-bin:" "$FAKE_NONO_CALL" >/dev/null
# A worker never runs the captain-home resolver.
grep -F "fm_home=unset" "$FAKE_NONO_CALL" >/dev/null

(
  cd "$CAPTAIN_DIR"
  ROE_FIRSTMATE_CAPTAIN=1 ROE_FIRSTMATE_SANDBOX_REQUIRED=1 \
    "$TMP/bin/codex" captain-brief
)
grep -F "nono:run --profile roe-firstmate-codex-captain --allow-cwd --read $TMP/real -- $TMP/real/codex --profile fm-captain --sandbox danger-full-access captain-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "captain=unset required=unset role=captain" "$FAKE_NONO_CALL" >/dev/null
grep -F "fm_home=$FM_HOME_DIR" "$FAKE_NONO_CALL" >/dev/null

# Claude must reach nono with CLAUDE_CONFIG_DIR on the real AI-volume path,
# whatever the launcher had (the container default is the ~/.claude symlink;
# a Herdr restore has nothing). Codex and pi have no such variable to carry.
(
  cd "$CAPTAIN_DIR"
  env -u CLAUDE_CONFIG_DIR ROE_FIRSTMATE_CAPTAIN=1 "$TMP/bin/codex" captain-brief
)
grep -F "config_dir=unset" "$FAKE_NONO_CALL" >/dev/null
(
  cd "$CAPTAIN_DIR"
  CLAUDE_CONFIG_DIR=/home/vscode/.claude ROE_FIRSTMATE_CAPTAIN=1 ROE_FIRSTMATE_SANDBOX_REQUIRED=1 \
    "$TMP/bin/claude" captain-brief
)
grep -F "nono:run --profile roe-firstmate-claude-captain --allow-cwd --read $TMP/real -- $TMP/real/claude captain-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "config_dir=$HOME/.ai/claude" "$FAKE_NONO_CALL" >/dev/null
(
  cd "$SLOT"
  env -u CLAUDE_CONFIG_DIR ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$TMP/bin/claude" worker-brief
)
grep -F "nono:run --profile roe-firstmate-claude-worker --allow-cwd --read $TMP/real -- $TMP/real/claude --strict-mcp-config worker-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "config_dir=$HOME/.ai/claude" "$FAKE_NONO_CALL" >/dev/null

# Pi takes no role-specific arguments: its model and thinking level arrive on
# the launch line from fm-spawn (crew) or from its own settings (captain).
(
  cd "$SLOT"
  ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$TMP/bin/pi" --model ollama/qwen --thinking low worker-brief
)
grep -F "nono:run --profile roe-firstmate-pi-worker --allow-cwd --read $TMP/real -- $TMP/real/pi --model ollama/qwen --thinking low worker-brief" \
  "$FAKE_NONO_CALL" >/dev/null
grep -F "captain=unset required=unset role=worker" "$FAKE_NONO_CALL" >/dev/null
grep -F "path=$TMP/worker-guard-bin:" "$FAKE_NONO_CALL" >/dev/null

(
  cd "$CAPTAIN_DIR"
  ROE_FIRSTMATE_CAPTAIN=1 ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$TMP/bin/pi" captain-brief
)
grep -F "nono:run --profile roe-firstmate-pi-captain --allow-cwd --read $TMP/real -- $TMP/real/pi captain-brief" \
  "$FAKE_NONO_CALL" >/dev/null

printf 'off\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"
(
  cd "$SLOT"
  ROE_FIRSTMATE_NONO="$TMP/missing-nono" "$TMP/bin/pi" unsandboxed-pi-worker
) 2>/dev/null
[[ "$(cat "$FAKE_REAL_CALL")" == "real:unsandboxed-pi-worker" ]]
printf 'on\n' >"$ROE_FIRSTMATE_SANDBOX_MODE_FILE"

# ── captain home: resolved before nono, fail closed, never created ───────────
# A Herdr restore bypasses fm, so the harness itself must recover the
# registered home; a wrong, unregistered or uninitialised home must stop the
# launch before nono runs, and nothing may be created on the way.
rm -f "$FAKE_NONO_CALL"
assert_fails_with "cannot establish the registered captain home" \
  bash -c "cd '$CAPTAIN_DIR' && FM_HOME='$TMP' '$TMP/bin/codex' wrong-home"
[[ ! -e "$FAKE_NONO_CALL" ]] || { echo "nono ran for a foreign FM_HOME"; exit 1; }

register_home /elsewhere
assert_fails_with "not registered for runtime coordination" \
  bash -c "cd '$CAPTAIN_DIR' && '$TMP/bin/codex' unregistered-home"
[[ ! -e "$FAKE_NONO_CALL" ]] || { echo "nono ran for an unregistered home"; exit 1; }
register_home "$FM_HOME_DIR"

rmdir "$FM_HOME_DIR/state"
assert_fails_with "refusing to create it" \
  bash -c "cd '$CAPTAIN_DIR' && '$TMP/bin/codex' uninitialised-home"
[[ ! -e "$FM_HOME_DIR/state" ]] || { echo "the captain home state directory was created"; exit 1; }
[[ ! -e "$FAKE_NONO_CALL" ]] || { echo "nono ran for an uninitialised home"; exit 1; }
mkdir "$FM_HOME_DIR/state"

# Hostile Node options must not reach the resolver.
(
  cd "$CAPTAIN_DIR"
  NODE_OPTIONS="--require $TMP/does-not-exist.cjs" "$TMP/bin/codex" node-options
)
grep -F "fm_home=$FM_HOME_DIR" "$FAKE_NONO_CALL" >/dev/null

# ── fail-closed on cwd (Herdr restore resumes agents with NO fm environment) ──
# A bare launch from the captain directory is the captain, sandboxed, with no
# ROE_FIRSTMATE_* variables at all.
(
  cd "$CAPTAIN_DIR"
  "$TMP/bin/codex" resumed-captain
)
grep -F "nono:run --profile roe-firstmate-codex-captain --allow-cwd --read $TMP/real -- $TMP/real/codex --profile fm-captain --sandbox danger-full-access resumed-captain" \
  "$FAKE_NONO_CALL" >/dev/null || { echo "bare launch in the captain directory must be sandboxed as captain"; exit 1; }
grep -F "fm_home=$FM_HOME_DIR" "$FAKE_NONO_CALL" >/dev/null

# A Treehouse slot OUTSIDE repos/ (local-dev-env's own, or a secondmate's) is
# a worker, sandboxed, with no variables at all.
LDE_SLOT="$FAKEROOT/.treehouse/ws-test/1/workspace"
mkdir -p "$(dirname "$LDE_SLOT")"
git -C "$BACKING" worktree add -q --detach "$LDE_SLOT" HEAD
(
  cd "$LDE_SLOT"
  "$TMP/bin/codex" resumed-worker
)
grep -F "nono:run --profile roe-firstmate-codex-worker --allow-cwd --read $TMP/real -- $TMP/real/codex --profile fm-worker --sandbox danger-full-access resumed-worker" \
  "$FAKE_NONO_CALL" >/dev/null || { echo "bare launch in a root .treehouse slot must be sandboxed as worker"; exit 1; }

printf 'ok - Firstmate harness launches fail closed through nono\n'
