#!/usr/bin/env bash
# Preflight and launch the bounded local Firstmate captain.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
DOTAI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=../firstmate/pins.env
source "$DOTAI_DIR/firstmate/pins.env"
# shellcheck source=firstmate-harness.sh
source "$SCRIPT_DIR/firstmate-harness.sh"
# shellcheck source=firstmate-sandbox-mode.sh
source "$SCRIPT_DIR/firstmate-sandbox-mode.sh"

FIRSTMATE_DIR="${FIRSTMATE_DIR:-/workspace/firstmate}"
export FM_HOME="${FM_HOME:-/workspace/.firstmate-home}"
export FM_BACKEND=herdr
export TREEHOUSE_ROOT=.
export ROE_FIRSTMATE_MAX_SLOTS
export ROE_FIRSTMATE_MAX_ACTIVE_TASKS
export ROE_FIRSTMATE_MAX_SECOND_MATES
export ROE_FIRSTMATE_SECOND_MATE_POOL_ROOT
export ROE_TREEHOUSE_REAL="${ROE_TREEHOUSE_REAL:-$HOME/.local/lib/roe-firstmate/treehouse}"
export PATH="$HOME/.local/bin:$PATH"
# Firstmate's bounded-run helper creates its status files with mktemp, which
# opens O_RDWR. The sandbox leaves /tmp write-only, so mktemp fails there and
# every bounded call returns 124 (reported as a spurious startup timeout).
export TMPDIR="${TMPDIR:-$HOME/.cache/roe-firstmate/tmp}"
mkdir -p "$TMPDIR"
NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
NONO_PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"
HARNESS_SANDBOX="$SCRIPT_DIR/firstmate-harness-sandbox.sh"
OPERATIONAL_DIR="${ROE_TREEHOUSE_REAL_DIR:-$HOME/.local/lib/roe-firstmate}"
TREEHOUSE_GUARD="$OPERATIONAL_DIR/treehouse-guard"
WORKER_GUARD_BIN="$OPERATIONAL_DIR/worker-guard-bin"
REAL_HARNESS_DIR="${ROE_FIRSTMATE_REAL_HARNESS_DIR:-$HOME/.local/lib/roe-firstmate/harnesses}"

HARNESS=""
CHECK_ONLY=0
PASSTHROUGH=()

die() {
  printf 'firstmate-local: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: fm [--check] [--harness claude|codex] [-- harness-args...]
       firstmate-local.sh [...]

Default harness is the pin written by setup-firstmate.sh (captain-harness, then
crew-harness). Override with --harness or FIRSTMATE_HARNESS=claude|codex.
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
[[ "$(readlink -f "$HOME/.local/bin/treehouse")" == "$(readlink -f "$TREEHOUSE_GUARD")" ]] \
  || die "treehouse on PATH is not the RoE fail-closed wrapper"
cmp -s "$TREEHOUSE_GUARD" "$SCRIPT_DIR/treehouse-firstmate-guard.sh" \
  || die "installed Treehouse guard is stale; run setup-firstmate.sh"
[[ -x "$WORKER_GUARD_BIN/terraform" && -x "$WORKER_GUARD_BIN/tofu" ]] \
  || die "worker Terraform guards are missing; run setup-firstmate.sh"
SANDBOX_MODE="$(fm_sandbox_mode)" \
  || die "invalid sandbox mode in $FM_SANDBOX_MODE_FILE; run fm-sandbox on or off"
if [[ "$SANDBOX_MODE" == on ]]; then
  [[ -x "$NONO" ]] || die "pinned nono binary is missing"
  [[ "$("$NONO" --version 2>/dev/null)" == "nono $NONO_VERSION" ]] \
    || die "nono is not at the reviewed pin $NONO_VERSION"
  "$NONO" setup --check-only >/dev/null \
    || die "Landlock is unavailable; refusing unsandboxed Firstmate launch"
else
  printf '\nWARNING: Firstmate nono sandbox is OFF; captain and workers have full devcontainer access.\n\n' >&2
fi

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

if [[ -z "$HARNESS" ]]; then
  if [[ -n "${FIRSTMATE_HARNESS:-}" ]]; then
    HARNESS="$(fm_harness_normalize "$FIRSTMATE_HARNESS")" \
      || die "FIRSTMATE_HARNESS must be claude or codex"
  elif current="$(fm_harness_current "$FM_HOME")"; then
    HARNESS="$current"
  else
    HARNESS=claude
  fi
fi

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
    die "Cursor Agent has no reviewed RoE nono profile; use claude or codex"
    ;;
  grok)
    die "Grok CLI has no reviewed RoE nono profile; use claude or codex"
    ;;
  *)
    die "unsupported pilot harness: $HARNESS"
    ;;
esac
[[ "$(readlink -f "$(command -v "$HARNESS")")" == "$(readlink -f "$HARNESS_SANDBOX")" ]] \
  || die "$HARNESS on PATH is not the RoE nono launcher"
[[ -x "$REAL_HARNESS_DIR/$HARNESS" ]] \
  || die "real $HARNESS executable is missing behind the nono launcher"
if [[ "$SANDBOX_MODE" == on ]]; then
  for role in captain worker; do
    [[ -f "$NONO_PROFILE_DIR/roe-firstmate-${HARNESS}-${role}.json" ]] \
      || die "nono profile is missing for $HARNESS $role"
  done
fi

printf 'Firstmate local pilot preflight passed.\n'
printf '  pin:      %s\n' "$FIRSTMATE_COMMIT"
printf '  FM_HOME:  %s\n' "$FM_HOME"
printf '  backend:  herdr\n'
printf '  harness:  %s\n' "$HARNESS"
printf '  sandbox:  %s\n' "${SANDBOX_MODE^^}"
printf '  projects: %s\n' "$project_count"
printf '  active:   %s/%s\n' "$active_meta" "$ROE_FIRSTMATE_MAX_ACTIVE_TASKS"

(( CHECK_ONLY == 1 )) && exit 0
[[ "${HERDR_ENV:-}" == 1 ]] \
  || die "launch from a Herdr-managed pane (HERDR_ENV=1); use --check for installation validation"

cd "$FIRSTMATE_DIR"
export ROE_FIRSTMATE_CAPTAIN=1
export ROE_FIRSTMATE_SANDBOX_REQUIRED=1
exec "${launch[@]}" "${PASSTHROUGH[@]}"
