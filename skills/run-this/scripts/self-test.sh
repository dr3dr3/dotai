#!/usr/bin/env bash
# self-test.sh — prove the run-this contract holds. Run this when asked
# "is run-this working?" instead of reasoning about it.
#
#   bash ~/.claude/skills/run-this/scripts/self-test.sh
#
# Uses a throwaway log dir so it never litters /workspace/tmp/.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="$HERE/capture.sh"; SCRUB="$HERE/scrub.sh"
export RUN_THIS_LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$RUN_THIS_LOG_DIR"' EXIT

pass=0; fail=0
ok()   { echo "  ok   $1"; pass=$((pass+1)); }
bad()  { echo "  FAIL $1"; fail=$((fail+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

echo "run-this self-test"
echo "--- capture.sh ---"
out=$("$CAP" t-fail --quiet -- bash -c 'echo visible; echo on-stderr >&2; exit 7' 2>&1); rc=$?
log=$(printf '%s\n' "$out" | tail -1)
check "exit code of the COMMAND propagates (7)"           '[[ $rc -eq 7 ]]'
check "last line printed is the log path"                 '[[ -f "$log" ]]'
check "log lives under the log dir, timestamped"          '[[ "$log" =~ /t-fail-[0-9]{14}\.log$ ]]'
check "stdout captured"                                   'grep -q "^visible$" "$log"'
check "stderr captured (2>&1)"                            'grep -q "^on-stderr$" "$log"'
check "DONE marker carries rc, is last line of log"       '[[ "$(tail -1 "$log")" =~ ^===\ DONE\ rc=7\ elapsed=[0-9]+s\ ===$ ]]'
check "header records the command"                        'grep -q "^command: bash -c" "$log"'
check "header does not dump the environment"              '! grep -q "^PATH=" "$log"'

out=$("$CAP" t-ok -- echo hello 2>&1); rc=$?
check "success rc is 0"                                   '[[ $rc -eq 0 ]]'
check "non-quiet mode echoes output to terminal"          'printf "%s\n" "$out" | grep -q "^hello$"'
check "non-quiet mode still ends with the path"           '[[ -f "$(printf "%s\n" "$out" | tail -1)" ]]'

first_line_ms() { local t0=$(date +%s%N); "$CAP" t-buf -- python3 -c 'print("PROMPT-URL"); import time; time.sleep(1.5)' 2>/dev/null | while read -r l; do [[ "$l" == PROMPT-URL ]] && { echo $(( ($(date +%s%N)-t0)/1000000 )); break; }; done; }
ms=$(first_line_ms)
check "interactive output is NOT held until exit (pty + sed -u): ${ms}ms" '[[ -n "$ms" && $ms -lt 1000 ]]'

"$CAP" t-secret --quiet -- bash -c 'echo "APP_KEY=base64:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ="' >/dev/null 2>&1
check "secrets scrubbed BEFORE reaching the log file"     '! grep -rq "abcdefghijklmnop" "$RUN_THIS_LOG_DIR"'

check "rejects a non-kebab slug"                          '! "$CAP" Bad_Slug -- true >/dev/null 2>&1'
check "rejects a missing --"                              '! "$CAP" t-nodash echo x >/dev/null 2>&1'
check "two runs never overwrite each other"               '[[ $(ls "$RUN_THIS_LOG_DIR" | wc -l) -ge 3 ]]'

echo "--- scrub.sh ---"
s() { printf '%s\n' "$1" | "$SCRUB"; }
check "KEY=value env secret"          '[[ "$(s "DB_PASSWORD=hunter2")" == "DB_PASSWORD=[REDACTED]" ]]'
check "quoted env value fully gone"   '[[ "$(s "export DB_PASSWORD=\"hunter two\"")" == "export DB_PASSWORD=[REDACTED]" ]]'
check "non-secret env untouched"      '[[ "$(s "DB_HOST=mysql DB_PORT=3306")" == "DB_HOST=mysql DB_PORT=3306" ]]'
check "PWD= is not treated as a password" '[[ "$(s "PWD=/workspace")" == "PWD=/workspace" ]]'
check "JSON secret field"             '[[ "$(s "\"access_token\": \"abc\"")" == "\"access_token\": \"[REDACTED]\"" ]]'
check "SSM .env blob wiped, siblings kept" '[[ "$(s "{\"Value\": \"APP_KEY=base64:x\\nDB_PASSWORD=y\", \"Type\": \"SecureString\"}")" == "{\"Value\": \"APP_KEY=[REDACTED]\", \"Type\": \"SecureString\"}" ]]'
check "Bearer token"                  '[[ "$(s "Authorization: Bearer 1|abcdef")" == "Authorization: Bearer [REDACTED]" ]]'
check "Laravel base64 key"            '[[ "$(s "key base64:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ=")" == "key base64:[REDACTED]" ]]'
# Fixtures are assembled at runtime so this file never contains a literal
# secret-shaped string — GitHub push protection (rightly) rejects those.
LIVE=$(printf "l%s" ive)
A=$(printf 'A%.0s' $(seq 1 26)); D=$(printf '%s' 0123456789)
check "AWS access key id"             '[[ "$(s "AKIA${A:0:16}")" == "[REDACTED-AWS-KEY-ID]" ]]'
check "GitHub token"                  '[[ "$(s "ghp_${A}${D}")" == "[REDACTED-GH-TOKEN]" ]]'
check "Linear key"                    '[[ "$(s "lin_api_${A}${D:0:6}")" == "[REDACTED-LINEAR-KEY]" ]]'
check "Stripe live key"               '[[ "$(s "sk_${LIVE}_${A}")" == "[REDACTED-STRIPE-KEY]" ]]'
check "JWT"                           '[[ "$(s "eyJ${A:0:12}.eyJ${A:0:12}.${A:0:12}")" == "[REDACTED-JWT]" ]]'
check "mysql -p inline password"      '[[ "$(s "mysql -uroot -psecret db -e \"SELECT 1\"")" == "mysql -uroot -p[REDACTED] db -e \"SELECT 1\"" ]]'
check "prose containing 'token' untouched" '[[ "$(s "the token bucket refilled")" == "the token bucket refilled" ]]'

echo "--- herdr-pane.sh ---"
HP="$HERE/herdr-pane.sh"
check "outside Herdr: exit 3, prints nothing"  'out=$(env -u HERDR_ENV "$HP" t -- echo x 2>&1); [[ $? -eq 3 && -z "$out" ]]'
check "rejects a non-kebab slug (before touching Herdr)" '! env -u HERDR_ENV "$HP" Bad_Slug -- true >/dev/null 2>&1'
check "rejects a missing --"                    '! env -u HERDR_ENV "$HP" t echo x >/dev/null 2>&1'
if [[ "${HERDR_ENV:-}" == 1 ]] && command -v herdr >/dev/null 2>&1 && herdr pane current --current >/dev/null 2>&1; then
  pane=$("$HP" t-herdr -- bash -c 'echo "a b"' 2>/dev/null); rc=$?
  check "inside Herdr: pane opened, id printed"  '[[ $rc -eq 0 && "$pane" =~ ^w[0-9]+:p ]]'
  sleep 0.5
  typed_readable() { herdr pane read "$pane" --source visible --lines 3 | grep -qF "bash -c 'echo \"a b\"'"; }
  fg_is_bash()     { herdr pane process-info --pane "$pane" | python3 -c 'import sys,json; fg=json.load(sys.stdin)["result"]["process_info"]["foreground_processes"]; sys.exit(0 if fg and fg[0]["name"]=="bash" else 1)'; }
  check "typed line is readable (single-quoted, no backslash soup)" typed_readable
  check "typed but NOT executed (no DONE marker in pane)" '! herdr pane read "$pane" --source visible --lines 5 | grep -q "=== DONE"'
  check "foreground shell is bash"              fg_is_bash
  herdr pane close "$pane" >/dev/null 2>&1
else
  echo "  skip inside-Herdr checks (HERDR_ENV != 1)"
fi

echo "--- result: $pass passed, $fail failed ---"
[[ $fail -eq 0 ]]
