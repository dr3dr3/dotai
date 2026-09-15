#!/usr/bin/env bash
# The Pi worker profile must allow exactly what fm-spawn's Pi contract needs
# (bin/fm-spawn.sh writes state/<id>.pi-ext.ts, which imports from the Firstmate
# clone and writes busy-state events + the turn-end marker into FM_HOME/state,
# and Pi itself writes sessions/trust under ~/.pi/agent → ~/.ai/pi) and nothing
# adjacent: not the captain's config, not another harness's state, not the
# Firstmate source, and no ambient credentials.

set -euo pipefail

NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"
FM_HOME="${FM_HOME:-/workspace/.firstmate-home}"

if [[ ! -x "$NONO" ]]; then
  printf 'skip - pinned nono is not installed\n'
  exit 0
fi
if [[ ! -f "$PROFILE_DIR/roe-firstmate-pi-worker.json" ]]; then
  printf 'skip - roe-firstmate-pi-worker profile is not installed (run setup-firstmate.sh)\n'
  exit 0
fi
if [[ ! -d "$HOME/.ai/pi" || ! -d "$FM_HOME/state" || ! -d /workspace/firstmate/bin ]]; then
  printf 'skip - Pi persistence, FM_HOME, or the Firstmate clone is missing\n'
  exit 0
fi

"$NONO" setup --check-only >/dev/null

WORK="$(mktemp -d /workspace/repos/.firstmate-pi-nono-work.XXXXXX)"
PROBE="nono-pi-probe.$$"
cleanup() {
  rm -rf "$WORK"
  rm -f "$HOME/.ai/pi/$PROBE" "$FM_HOME/state/$PROBE" "$FM_HOME/config/$PROBE" \
    "/workspace/firstmate/$PROBE" "$HOME/.ai/codex/$PROBE"
}
trap cleanup EXIT

(
  cd "$WORK"
  GH_TOKEN=must-not-leak AI_GATEWAY_API_KEY=must-not-leak FM_PI_HARNESS=pi \
    "$NONO" run --profile roe-firstmate-pi-worker --allow-cwd -- \
      bash -c '
        set -e
        probe=$1 fm_home=$2
        # intended operations
        touch allowed-write
        touch "$HOME/.pi/agent/$probe"              # via the ~/.pi/agent → ~/.ai/pi symlink
        touch "$fm_home/state/$probe"                # busy-state events + turn-end marker
        head -c 1 /workspace/firstmate/bin/fm-busy-event.sh >/dev/null   # -e extension imports
        test "$FM_PI_HARNESS" = pi
        # adjacent denials
        test -z "${GH_TOKEN:-}"
        test -z "${AI_GATEWAY_API_KEY:-}"
        ! touch "/workspace/firstmate/$probe" 2>/dev/null
        ! touch "$fm_home/config/$probe" 2>/dev/null
        ! touch "$HOME/.ai/codex/$probe" 2>/dev/null
        ! ls "$HOME/.ai/claude" >/dev/null 2>&1
      ' bash "$PROBE" "$FM_HOME"
)

[[ -f "$WORK/allowed-write" ]]
[[ -f "$HOME/.ai/pi/$PROBE" ]]
[[ -f "$FM_HOME/state/$PROBE" ]]
[[ ! -e "/workspace/firstmate/$PROBE" ]]
[[ ! -e "$FM_HOME/config/$PROBE" ]]
[[ ! -e "$HOME/.ai/codex/$PROBE" ]]

printf 'ok - nono confines the Firstmate Pi worker to its worktree, Pi state, and the busy-state contract\n'
