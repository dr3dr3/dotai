#!/usr/bin/env bash
# Preflight and launch the bounded local Firstmate captain.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
DOTAI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=../firstmate/pins.env
source "$DOTAI_DIR/firstmate/pins.env"

FIRSTMATE_DIR="${FIRSTMATE_DIR:-/workspace/firstmate}"
export FM_HOME="${FM_HOME:-/workspace/.firstmate-home}"
export FM_BACKEND=herdr
export TREEHOUSE_ROOT=.
export ROE_FIRSTMATE_MAX_SLOTS
export ROE_FIRSTMATE_MAX_ACTIVE_TASKS
export ROE_TREEHOUSE_REAL="${ROE_TREEHOUSE_REAL:-$HOME/.local/lib/roe-firstmate/treehouse}"
export PATH="$HOME/.local/bin:$PATH"

HARNESS=claude
CHECK_ONLY=0
PASSTHROUGH=()

die() {
  printf 'firstmate-local: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: fm [--check] [--harness claude|codex|cursor|grok] [-- harness-args...]
       firstmate-local.sh [...]

Run --check outside Herdr to validate installation. Launching a captain requires
HERDR_ENV=1 so the captain and crew remain visible in the current Herdr session.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --harness)
      [[ $# -ge 2 ]] || die "--harness requires a value"
      HARNESS="$2"
      shift 2
      ;;
    --)
      shift
      PASSTHROUGH=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -d "$FIRSTMATE_DIR/.git" ]] || die "Firstmate clone missing; run setup-firstmate.sh"
[[ -d "$FM_HOME/config" && -d "$FM_HOME/data" && -d "$FM_HOME/state" ]] \
  || die "FM_HOME is not initialized; run setup-firstmate.sh"
[[ -z "$(git -C "$FIRSTMATE_DIR" status --porcelain)" ]] \
  || die "upstream Firstmate clone is dirty"
[[ "$(git -C "$FIRSTMATE_DIR" rev-parse HEAD)" == "$FIRSTMATE_COMMIT" ]] \
  || die "Firstmate is not at the reviewed pin $FIRSTMATE_COMMIT"
[[ -x "$ROE_TREEHOUSE_REAL" ]] || die "verified Treehouse binary is missing"
[[ "$("$ROE_TREEHOUSE_REAL" --version 2>/dev/null | tr -cd '0-9.')" == "$TREEHOUSE_VERSION" ]] \
  || die "Treehouse is not at the reviewed pin $TREEHOUSE_VERSION"
[[ "$(readlink -f "$HOME/.local/bin/treehouse")" == "$(readlink -f "$SCRIPT_DIR/treehouse-firstmate-guard.sh")" ]] \
  || die "treehouse on PATH is not the RoE fail-closed wrapper"

for tool in git gh jq node no-mistakes gh-axi chrome-devtools-axi lavish-axi tasks-axi quota-axi herdr; do
  command -v "$tool" >/dev/null 2>&1 || die "required tool is missing: $tool"
done
gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated"

active_meta=0
shopt -s nullglob
for meta in "$FM_HOME"/state/*.meta; do
  [[ -f "$meta" ]] && ((active_meta += 1))
done
shopt -u nullglob
(( active_meta < ROE_FIRSTMATE_MAX_ACTIVE_TASKS )) \
  || die "task metadata limit reached ($active_meta/$ROE_FIRSTMATE_MAX_ACTIVE_TASKS); reconcile before launching"

project_count=0
shopt -s nullglob
for project_link in "$FM_HOME"/projects/*; do
  [[ -e "$project_link" ]] || continue
  project_path="$(readlink -f "$project_link")"
  [[ "$project_path/" == /workspace/repos/*/ ]] \
    || die "registered project is outside /workspace/repos: $project_link -> $project_path"
  [[ -d "$project_path/.git" ]] || die "registered project is not a Git checkout: $project_path"

  (
    cd "$project_path"
    "$SCRIPT_DIR/treehouse-firstmate-guard.sh" status --json >/dev/null
  ) || die "Treehouse preflight failed for $project_path"
  ((project_count += 1))
done
shopt -u nullglob
(( project_count > 0 )) || die "FM_HOME has no registered pilot project"

case "$HARNESS" in
  claude)
    command -v claude >/dev/null 2>&1 || die "Claude Code is not installed"
    launch=(claude)
    ;;
  codex)
    command -v codex >/dev/null 2>&1 || die "Codex CLI is not installed"
    launch=(codex)
    ;;
  cursor)
    command -v cursor-agent >/dev/null 2>&1 || die "Cursor Agent CLI is not installed"
    launch=(cursor-agent --trust)
    ;;
  grok)
    command -v grok >/dev/null 2>&1 || die "Grok CLI is not installed"
    launch=(grok --trust)
    ;;
  *)
    die "unsupported pilot harness: $HARNESS"
    ;;
esac

printf 'Firstmate local pilot preflight passed.\n'
printf '  pin:      %s\n' "$FIRSTMATE_COMMIT"
printf '  FM_HOME:  %s\n' "$FM_HOME"
printf '  backend:  herdr\n'
printf '  harness:  %s\n' "$HARNESS"
printf '  projects: %s\n' "$project_count"
printf '  active:   %s/%s\n' "$active_meta" "$ROE_FIRSTMATE_MAX_ACTIVE_TASKS"

(( CHECK_ONLY == 1 )) && exit 0
[[ "${HERDR_ENV:-}" == 1 ]] \
  || die "launch from a Herdr-managed pane (HERDR_ENV=1); use --check for installation validation"

cd "$FIRSTMATE_DIR"
exec "${launch[@]}" "${PASSTHROUGH[@]}"
