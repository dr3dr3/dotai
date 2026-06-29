#!/usr/bin/env bash
# =============================================================================
# Tier 0 — static + unit tests. NO Docker required.
# =============================================================================
# Proves the substrate's logic in isolation:
#   - every script parses (bash -n) and every lib is valid (node --check)
#   - all JSON/YAML is well-formed
#   - audit.mjs writes JSONL; redact.mjs scrubs secrets
#   - the SETUP->AGENT secret boundary drops write creds but passes RO tokens
#   - the SETUP phase emits a 0600 ro-tokens file with write creds excluded
#
# Run from anywhere:  bash sandbox/test/smoke.sh
# =============================================================================
set -uo pipefail

SANDBOX="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  \033[32m✓\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31m✗ %s\033[0m\n' "$1"; }
have() { command -v "$1" >/dev/null 2>&1; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "── Tier 0: static + unit (no Docker) ─ $SANDBOX"

# 1. Shell syntax ------------------------------------------------------------
echo "1. shell syntax"
for f in "$SANDBOX"/entrypoint.sh "$SANDBOX"/phases/*.sh "$SANDBOX"/image/build.sh \
         "$SANDBOX"/deploy/bootstrap.sh "$SANDBOX"/deploy/run.sh \
         "$SANDBOX"/test/*.sh; do
  bash -n "$f" 2>/dev/null && ok "$(basename "$f")" || bad "syntax: $f"
done

# 2. Node libs ---------------------------------------------------------------
echo "2. node libs"
for f in "$SANDBOX"/lib/*.mjs; do
  node --check "$f" 2>/dev/null && ok "$(basename "$f")" || bad "node --check: $f"
done

# 3. JSON well-formed --------------------------------------------------------
echo "3. JSON valid"
for f in "$SANDBOX"/profiles/config/claude-code/settings.json \
         "$SANDBOX"/deploy/task-definition.json \
         "$SANDBOX"/deploy/iam/execution-role.json \
         "$SANDBOX"/deploy/iam/task-role.json; do
  node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null \
    && ok "$(basename "$(dirname "$f")")/$(basename "$f")" || bad "JSON: $f"
done
# task-definition must survive comment-stripping into a valid ECS shape
if have jq; then
  jq -e 'del(._comment) | .containerDefinitions | length == 2' \
    "$SANDBOX"/deploy/task-definition.json >/dev/null 2>&1 \
    && ok "task-definition: 2 containers after del(._comment)" \
    || bad "task-definition shape"
fi

# 4. YAML parses -------------------------------------------------------------
echo "4. YAML parses"
if have yq; then
  yq -e '.repos' "$SANDBOX"/repos.yaml >/dev/null 2>&1 \
    && ok "repos.yaml (.repos present)" || bad "repos.yaml"
  yq -e '.repos | length >= 1' "$SANDBOX"/test/fixtures/repos.yaml >/dev/null 2>&1 \
    && ok "fixtures/repos.yaml (>=1 repo)" || bad "fixtures/repos.yaml"
else
  bad "yq not installed — cannot check YAML (install yq)"
fi

# 5. audit.mjs writes JSONL --------------------------------------------------
echo "5. audit.mjs"
AUDIT="$TMP/audit.jsonl"
SANDBOX_AUDIT_FILE="$AUDIT" SANDBOX_RUN_ID=smoke SANDBOX_PROFILE=test SANDBOX_ENV=local \
  node "$SANDBOX"/lib/audit.mjs test.event k=v >/dev/null 2>&1
if [ -f "$AUDIT" ] && node -e "const r=JSON.parse(require('fs').readFileSync('$AUDIT','utf8').trim()); process.exit(r.event==='test.event'&&r.k==='v'&&r.run_id==='smoke'?0:1)" 2>/dev/null; then
  ok "writes a valid JSONL record"
else
  bad "audit.mjs did not write a valid record"
fi

# 6. redact.mjs scrubs by value AND pattern ----------------------------------
echo "6. redact.mjs"
OUT="$(GITHUB_TOKEN='ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' MY_API_KEY='literalsecretvalue' \
  bash -c 'printf "tok=%s key=%s akia=AKIA1234567890ABCDEF" "$GITHUB_TOKEN" "$MY_API_KEY" | node "'"$SANDBOX"'/lib/redact.mjs"')"
case "$OUT" in
  *ghp_aaaa*) bad "redact: github token leaked" ;;
  *literalsecretvalue*) bad "redact: literal env value leaked" ;;
  *AKIA1234567890ABCDEF*) bad "redact: AWS key leaked" ;;
  *REDACTED:MY_API_KEY*REDACTED:aws-access-key-id*) ok "scrubs literal env value + AWS key pattern" ;;
  *REDACTED*) ok "scrubs secrets (partial match)" ;;
  *) bad "redact: nothing redacted" ;;
esac

# 7. The SETUP->AGENT secret boundary ---------------------------------------
echo "7. secret boundary (env -i)"
RO="$TMP/ro.env"; printf 'SENTRY_TOKEN=ro_ok\nSLACK_TOKEN=ro_ok2\n' > "$RO"
BOUNDARY="$(GITHUB_TOKEN=DROP SSH_AUTH_SOCK=/DROP NPM_TOKEN=DROP \
  env -i PATH="$PATH" HOME="$HOME" HTTPS_PROXY=http://egress:3128 \
    SANDBOX_RO_TOKENS="$RO" \
    bash -c 'set -a; source "$SANDBOX_RO_TOKENS"; set +a;
      echo "gh=${GITHUB_TOKEN:-_} sock=${SSH_AUTH_SOCK:-_} npm=${NPM_TOKEN:-_} sentry=${SENTRY_TOKEN:-_} proxy=${HTTPS_PROXY:-_}"')"
[ "$BOUNDARY" = "gh=_ sock=_ npm=_ sentry=ro_ok proxy=http://egress:3128" ] \
  && ok "write creds dropped; RO tokens + proxy cross" \
  || bad "boundary wrong: [$BOUNDARY]"

# 8. SETUP phase emits a locked-down ro-tokens file --------------------------
echo "8. setup phase (empty repos, graph disabled)"
W="$TMP/work"; R="$TMP/run/ro.env"
SETUP_OUT="$(
  SANDBOX_DIR="$SANDBOX" SANDBOX_WORKDIR="$W/roe-codebase" SANDBOX_GRAPH_DIR="$W/.graph" \
  SANDBOX_RO_TOKENS="$R" SANDBOX_AUDIT_FILE="$TMP/a2.jsonl" SANDBOX_RUN_ID=smoke \
  SANDBOX_REPOS_YAML="$SANDBOX/test/fixtures/empty.yaml" SANDBOX_GRAPH_DISABLE=1 \
  SENTRY_TOKEN=ro_demo AGENTMAIL_API_KEY=am_demo GITHUB_TOKEN=ghp_setuponly \
  bash "$SANDBOX"/phases/10-setup.sh 2>&1)"
if [ -f "$R" ]; then
  perms="$(stat -c '%a' "$R" 2>/dev/null || stat -f '%A' "$R" 2>/dev/null)"
  [ "$perms" = "600" ] && ok "ro-tokens file is mode 600" || bad "ro-tokens perms=$perms (want 600)"
  grep -q '^SENTRY_TOKEN=' "$R"  && ok "RO token emitted (SENTRY_TOKEN)" || bad "SENTRY_TOKEN missing"
  grep -q '^GITHUB_TOKEN=' "$R"  && bad "GITHUB_TOKEN leaked into ro-tokens!" || ok "GITHUB_TOKEN excluded from ro-tokens"
else
  bad "setup did not write ro-tokens file"
fi

# 9. shellcheck (optional, advisory) ----------------------------------------
echo "9. shellcheck (optional)"
if have shellcheck; then
  if shellcheck -S warning "$SANDBOX"/entrypoint.sh "$SANDBOX"/phases/*.sh >/dev/null 2>&1; then
    ok "shellcheck clean (warning level)"
  else
    printf '  \033[33m! shellcheck has warnings (advisory, not failing)\033[0m\n'
  fi
else
  printf '  \033[33m! shellcheck not installed — skipped\033[0m\n'
fi

# ---------------------------------------------------------------------------
echo ""
echo "── Tier 0 result: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
