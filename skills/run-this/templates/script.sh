#!/usr/bin/env bash
# <slug> — <one line: what this does and what we're looking for>
#
# Written by Claude for André to run via:
#   ~/.claude/skills/run-this/scripts/capture.sh <slug> -- bash /workspace/tmp/<slug>.sh
#
# capture.sh owns the log file, the exit code, scrubbing and the DONE marker.
# This script only has to (a) do the steps and (b) make each step's outcome
# legible in the log. Conventions:
#
#   * NO `set -e`. A probe should keep going and report every step, not stop
#     at the first failure and leave the later steps unknown.
#   * `step "name"` prints a banner so the log is skimmable by section.
#   * `run cmd…` prints the command, runs it, prints its rc. Never `|| true`.
#   * Print a sentinel for anything that can legitimately produce no rows —
#     `rows=0` is an answer, an empty section is a lost read.
#   * The script's own exit code should mean something: exit non-zero if any
#     step failed (tracked in $failed), so the DONE marker says rc≠0.
set -uo pipefail
failed=0

step() { printf '\n=== step: %s ===\n' "$*"; }
run()  { printf '$ %s\n' "$*"; "$@"; local rc=$?; printf '[rc=%s]\n' "$rc"; (( rc == 0 )) || failed=$((failed+1)); return $rc; }

step "context"
run date -u +%Y-%m-%dT%H:%M:%SZ
run git -C /workspace rev-parse --abbrev-ref HEAD

step "<first thing>"
# run make exec-api ARGS="php artisan tinker --execute='echo Order::count();'"

step "<second thing>"
# echo "rows=$(run something | wc -l)"

step "summary"
echo "failed_steps=$failed"
exit $(( failed > 0 ? 1 : 0 ))
