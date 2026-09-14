#!/usr/bin/env bash
# herdr-pane.sh — if this agent is running inside Herdr, open a bash pane next
# to it with the run-this block typed and waiting at the prompt. André presses
# Enter. Outside Herdr it exits 3 and prints nothing, so the caller falls back
# to the fenced block.
#
# Agent-neutral: plain bash + the `herdr` CLI, works the same from Claude Code
# and Codex.
#
#   herdr-pane.sh <slug> [--quiet] -- <command> [args...]
#
# Prints the new pane id on success. Exit codes:
#   0  pane opened, block typed (not executed)
#   2  usage error
#   3  not inside Herdr (HERDR_ENV != 1, no `herdr` binary, or the session
#      isn't reachable) — fall back to the fenced block
#   4  pane opened but bash never came to the foreground — the fish pane is
#      left open with `exec bash` sent; tell André
#
# Why one line, why send-text, why exec bash:
#   * `pane send-text` treats an embedded newline as Enter, so a multi-line
#     block would run every line but the last. We type exactly ONE line.
#   * `pane run` presses Enter. We deliberately don't: the whole point is that
#     André reads the command and runs it himself.
#   * New panes open his default shell (fish); `--env SHELL=…` does not change
#     that. `exec bash` does, and we poll process-info until bash is the
#     foreground process before typing anything.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CAP="$HOME/.claude/skills/run-this/scripts/capture.sh"   # the path André's shell resolves
[[ -x "$CAP" ]] || CAP="$HERE/capture.sh"

usage() { sed -n '2,/^set -uo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 2; }
[[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]] && usage
slug="$1"; shift
[[ "$slug" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || { echo "herdr-pane.sh: slug must be kebab-case (got '$slug')" >&2; exit 2; }
quiet=""
while [[ $# -gt 0 && "$1" != "--" ]]; do
  case "$1" in --quiet) quiet="--quiet" ;; *) echo "herdr-pane.sh: unknown option '$1'" >&2; exit 2 ;; esac; shift
done
[[ "${1:-}" == "--" ]] || { echo "herdr-pane.sh: missing '--' before the command" >&2; exit 2; }
shift; [[ $# -gt 0 ]] || { echo "herdr-pane.sh: no command given" >&2; exit 2; }

# ── Are we inside Herdr? ────────────────────────────────────────────────────
[[ "${HERDR_ENV:-}" == 1 ]] || exit 3
command -v herdr >/dev/null 2>&1 || exit 3
herdr pane current --current >/dev/null 2>&1 || exit 3

json() { python3 -c "import sys,json; d=json.load(sys.stdin); print($1)"; }

# ── Compose the ONE line he will run ────────────────────────────────────────
# Quote for a human reader, not a parser: bare when safe, single-quoted
# otherwise (printf %q produces backslash soup he has to squint at).
shq() { if [[ "$1" =~ ^[A-Za-z0-9_./:=@%+,-]+$ ]]; then printf '%s' "$1"; else printf "'%s'" "${1//\'/\'\\\'\'}"; fi; }
line="$CAP $slug${quiet:+ $quiet} --"
for a in "$@"; do line+=" $(shq "$a")"; done
[[ "$line" == *$'\n'* ]] && { echo "herdr-pane.sh: command contains a newline; wrap it in bash -c '…'" >&2; exit 2; }

# ── Split beside the calling pane, keep focus here ──────────────────────────
# Wide pane → split right; tall/narrow → split down (Herdr's own geometry rule).
dir=right
me="${HERDR_PANE_ID:-}"
read -r w h < <(herdr pane layout --current 2>/dev/null \
  | json 'next((f"{x[\"rect\"][\"width\"]} {x[\"rect\"][\"height\"]}" for x in d["result"]["layout"]["panes"] if x["pane_id"]=="'"$me"'"), "200 50")' 2>/dev/null || echo "200 50")
(( ${w:-200} < ${h:-50} * 3 )) && dir=down

pane=$(herdr pane split --current --direction "$dir" --cwd "$PWD" --no-focus 2>/dev/null | json 'd["result"]["pane"]["pane_id"]') || exit 3
[[ -n "$pane" ]] || exit 3
herdr pane rename "$pane" "run-this: $slug" >/dev/null 2>&1

# ── Get bash in the foreground ──────────────────────────────────────────────
herdr pane run "$pane" "exec bash" >/dev/null 2>&1
ready=0
for _ in $(seq 1 40); do   # 10s
  fg=$(herdr pane process-info --pane "$pane" 2>/dev/null | json '(d["result"]["process_info"]["foreground_processes"] or [{"name":""}])[0]["name"]')
  [[ "$fg" == bash ]] && { ready=1; break; }
  sleep 0.25
done
(( ready )) || { echo "herdr-pane.sh: pane $pane opened but bash did not come to the foreground" >&2; echo "$pane"; exit 4; }

# ── Type the line, do NOT press Enter ───────────────────────────────────────
herdr pane send-text "$pane" "$line" >/dev/null 2>&1 || exit 3
echo "$pane"
