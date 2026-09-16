#!/usr/bin/env bash
# Capability leases (ADR-2026-09-14-1 D6): fm-grant (captain side), roe-lease
# (worker side) and the harness launcher's lease wiring — against a fake op,
# a fake aws, a fake nono and an inline catalogue. No 1Password, no network.
#
# Every "must work" case is paired with a "must refuse" case: a lease that can
# only ever succeed is a credential path with no gate.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRANT="$ROOT/scripts/firstmate-grant.sh"
LEASE="$ROOT/scripts/firstmate-lease.sh"
WRAPPER="$ROOT/scripts/firstmate-harness-sandbox.sh"

TMP="$(mktemp -d /workspace/.treehouse/.firstmate-lease-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
assert_fails_with() {
  local expected="$1"; shift; local out
  if out="$("$@" 2>&1)"; then fail "expected failure: $* — got success: $out"; fi
  grep -F -- "$expected" <<<"$out" >/dev/null || fail "expected failure containing '$expected', got: $out"
}

# ── fixtures ────────────────────────────────────────────────────────────────
mkdir -p "$TMP/bin" "$TMP/home/.cache/roe-firstmate" "$TMP/home/.config/roe"
export HOME="$TMP/home"

# A Treehouse-shaped slot: <root>/.treehouse/<ws>/<n>/workspace
SLOT="$TMP/.treehouse/ws-test/1/workspace"; mkdir -p "$SLOT"
OTHER="$TMP/.treehouse/ws-test/2/workspace"; mkdir -p "$OTHER"

cat >"$TMP/profiles.json" <<'JSON'
{
  "schema_version": 1, "default_effect": "deny",
  "profiles": {
    "local-supervised": {
      "execution_plane": "local",
      "allowed": ["read_repository", "read_linear", "read_sentry", "read_aws_staging"],
      "denied": ["merge_pull_request", "deploy", "cut_release_tag", "run_fleet_migration", "run_destructive_operation", "access_production_credentials", "access_production_tenant_data", "change_payment_state", "widen_permissions"],
      "human_gates": ["merge", "grant_lease"],
      "lease_only": ["write_linear_comment"]
    }
  },
  "capabilities": {
    "read_sentry":  {"write": false, "scratch_home": true, "source": {"kind": "op", "item": "Sentry read token", "fields": {"SENTRY_AUTH_TOKEN": "credential"}}},
    "read_linear":  {"write": false, "source": {"kind": "op", "item": "Linear agent API key", "fields": {"LINEAR_API_KEY": "credential"}}},
    "write_linear_comment": {"write": true, "source": {"kind": "op", "item": "Linear agent API key", "fields": {"LINEAR_API_KEY": "credential"}}},
    "read_aws_staging": {"write": false, "source": {"kind": "aws", "profile": "roe-staging-readonly"}},
    "read_unminted": {"write": false, "source": {"kind": "op", "item": "Does Not Exist", "fields": {"X_TOKEN": "credential"}}},
    "access_production_credentials": {"write": true, "source": {"kind": "op", "item": "nope", "fields": {"P_TOKEN": "credential"}}}
  },
  "lease_defaults": {"ttl_seconds": 3600, "vault": "ROE - AI Agents", "lease_root": "$HOME/.cache/roe-firstmate/leases", "use_log_root": "$HOME/.cache/roe-firstmate/tmp/lease-use"}
}
JSON
export ROE_FIRSTMATE_AUTHORITY_PROFILES="$TMP/profiles.json"

# fake op: only answers with the crew service-account token, only for known items
cat >"$TMP/bin/op" <<'SH'
#!/usr/bin/env bash
[[ "${OP_SERVICE_ACCOUNT_TOKEN:-}" == "ops_crew_token" ]] || { echo "not signed in" >&2; exit 1; }
case "$1 $2" in
  "read op://ROE - AI Agents/Sentry read token/credential") echo "sntrys_bot_value" ;;
  "read op://ROE - AI Agents/Linear agent API key/credential") echo "lin_bot_va'lue" ;;   # embedded quote on purpose
  *) exit 1 ;;
esac
SH
cat >"$TMP/bin/aws" <<'SH'
#!/usr/bin/env bash
case "$*" in
  "configure export-credentials --profile roe-staging-readonly --format env-no-export") printf 'AWS_ACCESS_KEY_ID=ASIAFAKE\nAWS_SECRET_ACCESS_KEY=fakesecret\nAWS_SESSION_TOKEN=faketoken\n' ;;
  "configure get region --profile roe-staging-readonly") echo ap-southeast-2 ;;
  *) exit 1 ;;
esac
SH
chmod 0755 "$TMP/bin/op" "$TMP/bin/aws"
export PATH="$TMP/bin:$PATH"
printf "ROE_AI_AGENTS_OP_TOKEN='ops_crew_token'\n" >"$HOME/.config/roe/tooling.env"; chmod 600 "$HOME/.config/roe/tooling.env"

slot_id() { local p="$1"; p="${p#/workspace/}"; p="${p%/workspace}"; p="${p//\/.treehouse\//--}"; p="${p/#.treehouse\//local-dev-env--}"; p="${p//\//--}"; printf '%s' "${p//./_}"; }
SLOT_ID="$(slot_id "$SLOT")"
LEASE_DIR="$HOME/.cache/roe-firstmate/leases/$SLOT_ID"

echo "fm-grant"
# ── refusals first ──────────────────────────────────────────────────────────
assert_fails_with "--slot" bash "$GRANT" --task t1 --cap read_sentry
assert_fails_with "not a Treehouse slot path" bash "$GRANT" --slot "$TMP" --task t1 --cap read_sentry
assert_fails_with "unknown capability: read_mars" bash "$GRANT" --slot "$SLOT" --task t1 --cap read_mars
assert_fails_with "is DENIED for profile local-supervised" bash "$GRANT" --slot "$SLOT" --task t1 --cap access_production_credentials
assert_fails_with "could not read op://ROE - AI Agents/Does Not Exist/credential" bash "$GRANT" --slot "$SLOT" --task t1 --cap read_unminted
[[ ! -e "$LEASE_DIR/read_unminted.env" ]] || fail "a failed resolution must not leave a lease file"
assert_fails_with "--ttl must be 60..86400" bash "$GRANT" --slot "$SLOT" --task t1 --cap read_sentry --ttl 10
assert_fails_with "needs ROE_AI_AGENTS_OP_TOKEN" env ROE_TOOLING_STORE=/nonexistent bash "$GRANT" --slot "$SLOT" --task t1 --cap read_sentry
echo "  ok  refuses: no slot, non-slot path, unknown cap, denied cap, unminted item, bad ttl, no service-account token"

# ── grants ──────────────────────────────────────────────────────────────────
out="$(bash "$GRANT" --slot "$SLOT" --task eng-1 --cap read_sentry --cap read_linear --cap read_aws_staging --ttl 120)"
grep -q "granted read_sentry" <<<"$out" && grep -q "granted read_aws_staging" <<<"$out" || fail "grant output: $out"
grep -qE "sntrys_bot_value|lin_bot|fakesecret|ops_crew_token" <<<"$out" && fail "a credential value leaked into fm-grant output"
for c in read_sentry read_linear read_aws_staging; do
  [[ -f "$LEASE_DIR/$c.env" ]] || fail "missing lease $c"
  [[ "$(stat -c %a "$LEASE_DIR/$c.env")" == 600 ]] || fail "$c lease is not 0600"
  grep -q "^# lease cap=$c task=eng-1 slot=$SLOT_ID granted_at=.* expires_at=.* granted_by=" "$LEASE_DIR/$c.env" || fail "$c header wrong: $(head -1 "$LEASE_DIR/$c.env")"
done
grep -q "^LINEAR_API_KEY='lin_bot_va'\\\\''lue'$" "$LEASE_DIR/read_linear.env" || fail "quote escaping wrong: $(grep LINEAR "$LEASE_DIR/read_linear.env")"
grep -q "^AWS_SESSION_TOKEN='faketoken'$" "$LEASE_DIR/read_aws_staging.env" && grep -q "^AWS_DEFAULT_REGION='ap-southeast-2'$" "$LEASE_DIR/read_aws_staging.env" || fail "aws lease content"
[[ "$(stat -c %a "$LEASE_DIR")" == 700 ]] || fail "slot lease dir is not 0700"
echo "  ok  grants three caps, 0600 files, header, quote-safe values, no values in output"

out="$(bash "$GRANT" --slot "$SLOT" --task eng-1 --defaults)"
n="$(grep -c "^granted " <<<"$out")"; [[ "$n" == 3 ]] || fail "--defaults should grant the 3 allowed catalogue caps, got $n: $out"
grep -q "write_linear_comment" <<<"$out" && fail "--defaults must never include a lease_only capability"
echo "  ok  --defaults grants exactly the profile's allowed catalogue capabilities"

out="$(bash "$GRANT" --slot "$SLOT" --task eng-1 --cap write_linear_comment)"
grep -q "granted write_linear_comment" <<<"$out" || fail "lease_only cap should be grantable explicitly: $out"
echo "  ok  lease_only capability grantable explicitly"

out="$(bash "$GRANT" --slot "$SLOT" --status)"; grep -q "read_sentry" <<<"$out" && grep -q "uses=0" <<<"$out" || fail "status: $out"
out="$(bash "$GRANT" --list)"; grep -q "$SLOT_ID" <<<"$out" || fail "list: $out"
echo "  ok  status and list"

echo "roe-lease"
# ── worker side ─────────────────────────────────────────────────────────────
run_in_slot() { ( cd "$SLOT" && bash "$LEASE" "$@" ); }
assert_fails_with "not inside a Treehouse worker slot" bash -c "cd '$TMP' && bash '$LEASE' read_sentry -- true"
assert_fails_with "no lease for read_mars in this slot" bash -c "cd '$SLOT' && bash '$LEASE' read_mars -- true"
grep -q "fm-grant --slot" <<<"$(cd "$SLOT" && bash "$LEASE" read_mars -- true 2>&1 || true)" || fail "missing-lease message should name the captain command"
echo "  ok  refuses outside a slot and without a lease, naming the grant command"

out="$(run_in_slot --list)"; grep -q "read_sentry" <<<"$out" && grep -q "write_linear_comment" <<<"$out" || fail "list: $out"
grep -qE "sntrys|lin_bot|fakesecret" <<<"$out" && fail "--list leaked a value"
run_in_slot read_sentry --check >/dev/null || fail "--check should pass on a live lease"

# exec with ONLY that capability's variables
out="$(run_in_slot read_sentry -- sh -c 'echo "S=${SENTRY_AUTH_TOKEN:-unset} L=${LINEAR_API_KEY:-unset} A=${AWS_SECRET_ACCESS_KEY:-unset}"')"
[[ "$out" == "S=sntrys_bot_value L=unset A=unset" ]] || fail "env isolation: $out"
out="$(run_in_slot read_linear -- sh -c 'printf "%s" "$LINEAR_API_KEY"')"
[[ "$out" == "lin_bot_va'lue" ]] || fail "value round-trip with embedded quote: $out"
out="$(run_in_slot read_aws_staging -- sh -c 'echo "$AWS_DEFAULT_REGION"')"; [[ "$out" == ap-southeast-2 ]] || fail "aws region"
echo "  ok  exec sees only the leased capability's variables; values round-trip"

# scratch_home: read_sentry runs with a per-slot HOME; read_linear keeps the real one
out="$(run_in_slot read_sentry -- sh -c 'echo "$HOME"')"
[[ "$out" == "$HOME/.cache/roe-firstmate/tmp/lease-use/$SLOT_ID/home" ]] || fail "scratch_home not applied: $out"
[[ -d "$out" ]] || fail "scratch HOME not created"
out="$(run_in_slot read_linear -- sh -c 'echo "$HOME"')"
[[ "$out" == "$HOME" ]] || fail "HOME must be untouched for a capability without scratch_home: $out"
echo "  ok  scratch_home redirects HOME for the flagged capability only"

# exit code of the wrapped command propagates
( cd "$SLOT" && bash "$LEASE" read_sentry -- sh -c 'exit 7' ) && fail "exit code not propagated" || [[ $? == 7 ]] || fail "expected exit 7"
echo "  ok  wrapped command exit code propagates"

# use log: one line per use, argv[0] only
log="$HOME/.cache/roe-firstmate/tmp/lease-use/$SLOT_ID/read_sentry.log"
[[ -f "$log" ]] || fail "use log missing"
n="$(wc -l <"$log")"; [[ "$n" == 2 ]] || fail "expected 2 uses of read_sentry logged, got $n"
grep -q " cap=read_sentry cmd=sh$" "$log" || fail "use log line shape: $(tail -1 "$log")"
grep -qE "sntrys|exit 7" "$log" && fail "use log must not contain values or arguments"
out="$(bash "$GRANT" --slot "$SLOT" --status)"; grep -q "read_sentry .*uses=2" <<<"$out" || fail "status should report uses=2: $out"
echo "  ok  use log records each use (argv[0] only) and status counts it"

# another slot cannot see this slot's leases (path-derived, not shared)
( cd "$OTHER" && bash "$LEASE" --list ) | grep -q "no leases for this slot" || fail "other slot saw leases"
echo "  ok  leases are per slot"

# expiry: rewrite the header to the past → refused with exit 3, and --check says so
sed -i 's/ expires_at=[^ ]*/ expires_at=2000-01-01T00:00:00Z/' "$LEASE_DIR/read_sentry.env"
( cd "$SLOT" && bash "$LEASE" read_sentry -- true ) 2>/dev/null && fail "expired lease accepted" || [[ $? == 3 ]] || fail "expired lease should exit 3"
assert_fails_with "expired at 2000-01-01T00:00:00Z" bash -c "cd '$SLOT' && bash '$LEASE' read_sentry --check"
echo "  ok  expired lease refused (exit 3)"

# revoke
bash "$GRANT" --slot "$SLOT" --revoke --cap read_linear >/dev/null
[[ ! -e "$LEASE_DIR/read_linear.env" ]] || fail "revoke --cap left the file"
assert_fails_with "no lease for read_linear" bash -c "cd '$SLOT' && bash '$LEASE' read_linear -- true"
bash "$GRANT" --slot "$SLOT" --revoke >/dev/null
[[ ! -e "$LEASE_DIR" ]] || fail "revoke-all left the dir"
echo "  ok  revoke one, revoke all — immediate"

echo "launcher"
# ── harness launcher: --read for the slot's lease dir, --strict-mcp-config for claude workers ──
L="$TMP/launcher"; mkdir -p "$L/bin" "$L/real" "$L/profiles" "$L/guard"
touch "$L/profiles/roe-firstmate-claude-worker.json" "$L/profiles/roe-firstmate-claude-captain.json" "$L/profiles/roe-firstmate-codex-worker.json"
touch "$L/guard/terraform" "$L/guard/tofu"; chmod 0755 "$L/guard/terraform" "$L/guard/tofu"
printf '#!/usr/bin/env bash\nprintf "real:%%s\\n" "$*" >"$FAKE_REAL_CALL"\n' >"$L/real/claude"; cp "$L/real/claude" "$L/real/codex"; chmod 0755 "$L/real/"*
cat >"$L/fake-nono" <<'SH'
#!/usr/bin/env bash
[[ "${1:-}" == --version ]] && { echo "nono 0.76.0"; exit 0; }
printf 'nono:%s\n' "$*" >"$FAKE_NONO_CALL"
SH
chmod 0755 "$L/fake-nono"
cat >"$L/fake-grant" <<'SH'
#!/usr/bin/env bash
printf 'grant:%s\n' "$*" >"$FAKE_GRANT_CALL"
SH
chmod 0755 "$L/fake-grant"
ln -s "$WRAPPER" "$L/bin/claude"; ln -s "$WRAPPER" "$L/bin/codex"
export ROE_FIRSTMATE_NONO="$L/fake-nono" ROE_FIRSTMATE_REAL_HARNESS_DIR="$L/real" ROE_FIRSTMATE_NONO_PROFILE_DIR="$L/profiles"
export ROE_FIRSTMATE_SANDBOX_MODE_FILE="$L/mode" ROE_FIRSTMATE_WORKER_GUARD_BIN="$L/guard" ROE_FIRSTMATE_GRANT_BIN="$L/fake-grant"
export ROE_FIRSTMATE_LEASE_ROOT="$HOME/.cache/roe-firstmate/leases"
export FAKE_NONO_CALL="$L/nono-call" FAKE_REAL_CALL="$L/real-call" FAKE_GRANT_CALL="$L/grant-call"
printf 'on\n' >"$L/mode"

# a worker slot the launcher recognises: /workspace/repos/<repo>/.treehouse/<ws>/<n>/workspace — use a git worktree there
WREPO="/workspace/repos/rock-of-eye-api"; WSLOT="$WREPO/.treehouse/lease-test-$$/1/workspace"
mkdir -p "$(dirname "$WSLOT")"; git -C "$WREPO" worktree add -q --detach "$WSLOT" HEAD 2>/dev/null || fail "could not create a test worktree under $WREPO"
trap 'git -C "$WREPO" worktree remove --force "$WSLOT" 2>/dev/null; rm -rf "$(dirname "$(dirname "$WSLOT")")" "$TMP"' EXIT
WSLOT_ID="$(slot_id "$WSLOT")"

# no lease dir yet → no --read, but the auto-grant was attempted with the slot path
( cd "$WSLOT" && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$L/bin/claude" brief )
grep -qF "grant:--slot $WSLOT --task unassigned --defaults" "$FAKE_GRANT_CALL" || fail "auto-grant not invoked correctly: $(cat "$FAKE_GRANT_CALL")"
grep -qF "nono:run --profile roe-firstmate-claude-worker --allow-cwd -- $L/real/claude --strict-mcp-config brief" "$FAKE_NONO_CALL" || fail "claude worker launch: $(cat "$FAKE_NONO_CALL")"
echo "  ok  claude worker: auto-grant attempted, --strict-mcp-config, no --read without leases"

# with a lease dir → --read exactly that dir
mkdir -p "$ROE_FIRSTMATE_LEASE_ROOT/$WSLOT_ID"
( cd "$WSLOT" && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 FM_TASK_ID=eng-9 "$L/bin/claude" brief )
grep -qF "nono:run --profile roe-firstmate-claude-worker --allow-cwd --read $ROE_FIRSTMATE_LEASE_ROOT/$WSLOT_ID -- $L/real/claude --strict-mcp-config brief" "$FAKE_NONO_CALL" || fail "lease --read missing: $(cat "$FAKE_NONO_CALL")"
grep -qF "grant:--slot $WSLOT --task eng-9 --defaults" "$FAKE_GRANT_CALL" || fail "FM_TASK_ID not passed to auto-grant"
echo "  ok  worker sandbox gets --read for exactly its slot's lease dir; task id flows into the grant"

# auto-grant off → no grant call
rm -f "$FAKE_GRANT_CALL"
( cd "$WSLOT" && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 ROE_FIRSTMATE_AUTO_LEASES=0 "$L/bin/claude" brief )
[[ ! -e "$FAKE_GRANT_CALL" ]] || fail "ROE_FIRSTMATE_AUTO_LEASES=0 should skip the grant"
# a failing auto-grant must not stop the worker
printf '#!/usr/bin/env bash\nexit 1\n' >"$L/fake-grant"
( cd "$WSLOT" && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$L/bin/claude" brief ) 2>"$L/warn"
grep -q "default capability leases were not all granted" "$L/warn" || fail "failed auto-grant should warn, not die"
grep -qF "brief" "$FAKE_NONO_CALL" || fail "worker did not launch after a failed auto-grant"
echo "  ok  auto-grant is skippable and non-fatal"

# captain: never --strict-mcp-config, never --read, never a grant
rm -f "$FAKE_GRANT_CALL"
( cd /workspace/firstmate && ROE_FIRSTMATE_CAPTAIN=1 ROE_FIRSTMATE_SANDBOX_REQUIRED=1 "$L/bin/claude" cap )
grep -qF "nono:run --profile roe-firstmate-claude-captain --allow-cwd -- $L/real/claude cap" "$FAKE_NONO_CALL" || fail "captain launch changed: $(cat "$FAKE_NONO_CALL")"
[[ ! -e "$FAKE_GRANT_CALL" ]] || fail "captain must not auto-grant"
# codex worker keeps its own args, no strict-mcp flag
( cd "$WSLOT" && ROE_FIRSTMATE_SANDBOX_REQUIRED=1 ROE_FIRSTMATE_AUTO_LEASES=0 "$L/bin/codex" brief )
grep -qF -- "--profile fm-worker --sandbox danger-full-access brief" "$FAKE_NONO_CALL" || fail "codex worker args changed"
grep -qF -- "--strict-mcp-config" "$FAKE_NONO_CALL" && fail "codex must not get a claude flag"
echo "  ok  captain and codex launches unchanged"

printf 'ok - capability leases: grant, consume, log, expire, revoke, and the launcher wiring\n'
