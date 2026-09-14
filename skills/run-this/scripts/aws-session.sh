#!/usr/bin/env bash
# aws-session.sh — is the Rock of Eye SSO session live, and does <profile> resolve?
#
# Run this BEFORE deciding whether an AWS command needs André's terminal. If the
# session is live and the call is read-only, Claude runs it itself with Bash —
# no block, no paste. A block is only for `aws sso login` (interactive) or for
# a write against production.
#
#   aws-session.sh [profile ...]        default: roe-prod roe-staging-audit roe-sandbox
#
# Exit 0 if every named profile resolves, 1 otherwise. Prints token expiry so
# you can tell "will this survive a 20-minute sweep".
set -uo pipefail
profiles=("$@"); [[ ${#profiles[@]} -eq 0 ]] && profiles=(roe-prod roe-staging-audit roe-sandbox)

exp=$(python3 - <<'PY' 2>/dev/null
import json,glob,os,datetime
best=None
for f in glob.glob(os.path.expanduser('~/.aws/sso/cache/*.json')):
    try: d=json.load(open(f))
    except Exception: continue
    if d.get('startUrl','').startswith('https://d-976794dddf') and 'expiresAt' in d:
        best=d['expiresAt'] if best is None or d['expiresAt']>best else best
if best:
    e=datetime.datetime.fromisoformat(best.replace('Z','+00:00'))
    left=int((e-datetime.datetime.now(datetime.timezone.utc)).total_seconds()//60)
    print(f"{best} ({left} min left)" if left>0 else f"{best} (EXPIRED)")
else: print("no cached token")
PY
)
echo "sso_session rockofeye: token expires $exp"

rc=0
for p in "${profiles[@]}"; do
  arn=$(aws sts get-caller-identity --profile "$p" --query Arn --output text 2>&1 | tail -1)
  if [[ "$arn" == arn:aws:sts::* ]]; then
    role=${arn#*assumed-role/AWSReservedSSO_}; role=${role%%_*}
    acct=${arn#arn:aws:sts::}; acct=${acct%%:*}
    printf '  live    %-24s %s @ %s\n' "$p" "$role" "$acct"
  elif [[ "$arn" == *ForbiddenException* ]]; then
    # Token is fine; the role just isn't assigned to him (break-glass is inert
    # until `make break-glass-grant`, ADR-039). Not a login problem.
    printf '  NO ROLE %-24s role not assigned to this user (not a login problem)\n' "$p"; rc=1
  else
    printf '  EXPIRED %-24s %s\n' "$p" "${arn:0:100}"; rc=1; need_login=1
  fi
done
(( ${need_login:-0} )) && echo "→ needs: aws sso login --sso-session rockofeye --use-device-code --no-browser   (interactive — hand André a block)"
exit $rc
