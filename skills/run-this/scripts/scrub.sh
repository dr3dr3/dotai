#!/usr/bin/env bash
# scrub.sh — redact secrets from a stream. stdin → stdout, line-oriented.
#
# capture.sh pipes every command through this BEFORE tee, so a secret never
# reaches the log file (or the terminal). Deliberately over-redacts: a SSM
# parameter that is a whole .env blob on one JSON line gets its value wiped
# from the first secret-looking key onwards, which is the right outcome — the
# log is shareable, the blob is not.
#
# Usage:  some-command 2>&1 | scrub.sh
# Test:   scripts/self-test.sh
#
# Add a pattern here, never a bypass. There is no --no-scrub on purpose.
set -uo pipefail

# One value alternation shared by the KEY=value rules: a double-quoted string,
# a single-quoted string, or an unquoted run up to whitespace/quote.
V='("[^"]*"|'"'"'[^'"'"']*'"'"'|[^"'"'"'[:space:]]*)'

exec sed -u -E \
  -e 's/\r$//' \
  -e "s/\b((APP_KEY|MYSQL_PWD|PGPASSWORD|[A-Za-z0-9_]*(SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|ENCRYPTION_KEY)[A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*)${V}/\1[REDACTED]/gI" \
  -e 's/("[A-Za-z0-9_]*(secret|token|password|passwd|api_key|apikey|access_key|private_key)[A-Za-z0-9_]*"[[:space:]]*:[[:space:]]*")[^"]*"/\1[REDACTED]"/gI' \
  -e 's/((Authorization|X-ROE-INTERNAL-TOKEN|X-PMS-ACCESS-TOKEN|X-ROE-SSO-KEY)[[:space:]]*:[[:space:]]*(Bearer[[:space:]]+)?)[^[:space:]"]+/\1[REDACTED]/gI' \
  -e 's/base64:[A-Za-z0-9+\/=]{32,}/base64:[REDACTED]/g' \
  -e 's/\bAKIA[0-9A-Z]{16}\b/[REDACTED-AWS-KEY-ID]/g' \
  -e 's/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/[REDACTED-GH-TOKEN]/g' \
  -e 's/\blin_api_[A-Za-z0-9]{20,}\b/[REDACTED-LINEAR-KEY]/g' \
  -e 's/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/[REDACTED-SLACK-TOKEN]/g' \
  -e 's/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{16,}\b/[REDACTED-STRIPE-KEY]/g' \
  -e 's/\bsk-(proj-)?[A-Za-z0-9_-]{20,}\b/[REDACTED-OPENAI-KEY]/g' \
  -e 's/\bsntrys_[A-Za-z0-9_=-]{20,}\b/[REDACTED-SENTRY-TOKEN]/g' \
  -e 's/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/[REDACTED-JWT]/g' \
  -e 's/(mysql[^|;&]*[[:space:]]-p)[^[:space:]]+/\1[REDACTED]/g' \
  -e 's/-----BEGIN [A-Z ]*PRIVATE KEY-----.*/-----BEGIN PRIVATE KEY----- [REDACTED]/'
