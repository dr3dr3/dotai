#!/usr/bin/env bash
# capture.sh — run a command in André's terminal, capture EVERYTHING to a
# timestamped log under /workspace/tmp/, and print that path as the last line.
#
# This is the run-this contract in one place, so a session never has to get
# the exit-code / DONE-marker / stderr / scrubbing dance right by hand:
#
#   * stdout AND stderr are captured (2>&1), never discarded
#   * output streams through scrub.sh BEFORE it hits disk or the terminal
#   * output is also tee'd to the terminal, so interactive prompts (AWS SSO
#     device codes, sudo, gh auth) are still visible while he runs it
#   * the exit code is the COMMAND's (PIPESTATUS), captured before the marker
#   * the log ends with "=== DONE rc=<n> elapsed=<s>s ===" so a truncated
#     log is distinguishable from one still being written
#   * the log path is the last line printed, ready to copy
#
# Usage:
#   capture.sh <slug> [--quiet] -- <command> [args...]
#   capture.sh <slug> [--quiet] -- bash /workspace/tmp/<slug>.sh
#
#   <slug>    kebab-case name for the log file (e.g. eng-2621-fk-impact)
#   --quiet   don't echo output to the terminal (huge or noisy runs); the
#             path still prints and the file is still complete
#
# For pipelines, redirects, or shell syntax, wrap the command:
#   capture.sh my-probe -- bash -c 'make exec-api ARGS="..." | grep -c rows'
#
# Everything after `--` is exec'd verbatim (no eval), so quoting is preserved.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRUB="$HERE/scrub.sh"
LOG_DIR="${RUN_THIS_LOG_DIR:-/workspace/tmp}"

usage() { sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2; }

[[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage
slug="$1"; shift
[[ "$slug" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "capture.sh: slug must be kebab-case (got '$slug')" >&2; exit 2; }

quiet=0
while [[ $# -gt 0 && "$1" != "--" ]]; do
  case "$1" in
    --quiet) quiet=1 ;;
    *) echo "capture.sh: unknown option '$1' (did you forget the '--'?)" >&2; exit 2 ;;
  esac
  shift
done
[[ "${1:-}" == "--" ]] || { echo "capture.sh: missing '--' before the command" >&2; exit 2; }
shift
[[ $# -gt 0 ]] || { echo "capture.sh: no command given after '--'" >&2; exit 2; }
[[ -x "$SCRUB" ]] || { echo "capture.sh: scrub.sh missing or not executable at $SCRUB" >&2; exit 2; }

mkdir -p "$LOG_DIR"
L="$LOG_DIR/$slug-$(date -u +%Y%m%d%H%M%S).log"

# Header — enough to tell WHICH run this was when he re-runs and gets a second
# file. No env dump: that's exactly the kind of thing that leaks a secret.
{
  echo "=== run-this: $slug ==="
  echo "started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "cwd:     $PWD"
  echo "host:    $(hostname)"
  inst="${ROE_INSTANCE:-$(grep -s "^ROE_INSTANCE=" /workspace/.env | cut -d= -f2)}"; echo "roe_instance: ${inst:-1 (default, roe- prefix)}"
  printf 'command:'; printf ' %q' "$@"; echo
  echo "=== output ==="
} | "$SCRUB" > "$L"   # the command line itself can carry a secret (-p…, -H Authorization:…)

start=$(date +%s)
if (( quiet )); then
  "$@" 2>&1 | "$SCRUB" >> "$L"
  rc=${PIPESTATUS[0]}
else
  # Non-quiet = he is watching, and possibly being asked something. Give the
  # command a pty via script(1): programs that block-buffer stdout when it is
  # a pipe (Python — so the AWS CLI — among others) would otherwise hold the
  # device-code URL until exit, and he'd sit at a blank screen and Ctrl-C.
  # `-e` returns the child's exit status; `-q` no "Script started" banner.
  cmd=$(printf '%q ' "$@")
  script -qefc "$cmd" /dev/null 2>&1 | "$SCRUB" | tee -a "$L"
  rc=${PIPESTATUS[0]}
fi
elapsed=$(( $(date +%s) - start ))

marker="=== DONE rc=$rc elapsed=${elapsed}s ==="
echo "$marker" >> "$L"
(( quiet )) && echo "$marker"
echo "$L"
exit "$rc"
