#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"

for harness in claude codex; do
  jq -e '.filesystem.allow | index("/workspace/.firstmate-secondmates") != null' \
    "$ROOT/firstmate/nono/roe-firstmate-$harness-captain.json" >/dev/null
  for project in rock-of-eye-production-core rock-of-eye-production-portal; do
    backing="/workspace/repos/$project/.treehouse/firstmate-backing/$project"
    jq -e --arg backing "$backing" '.filesystem.allow | index($backing) != null' \
      "$ROOT/firstmate/nono/roe-firstmate-$harness-captain.json" >/dev/null
  done
  jq -e '(.filesystem.allow | index("/workspace/.firstmate-secondmates")) == null' \
    "$ROOT/firstmate/nono/roe-firstmate-$harness-worker.json" >/dev/null
done

if [[ ! -x "$NONO" ]]; then
  printf 'skip - pinned nono is not installed\n'
  exit 0
fi

"$NONO" setup --check-only >/dev/null

WORK="$(mktemp -d /workspace/repos/.firstmate-nono-work.XXXXXX)"
SIBLING="$(mktemp -d /workspace/repos/.firstmate-nono-sibling.XXXXXX)"
trap 'rm -rf "$WORK" "$SIBLING"' EXIT
printf 'must-not-read\n' >"$SIBLING/secret"

(
  cd "$WORK"
  GH_TOKEN=must-not-leak FM_TEST_MARKER=preserved \
    "$NONO" run --profile roe-firstmate-codex-worker --allow-cwd -- \
      bash -c '
        set -e
        touch allowed-write
        test "$FM_TEST_MARKER" = preserved
        test -z "${GH_TOKEN:-}"
        ! cat "$1" >/dev/null 2>&1
        ! touch "$2" 2>/dev/null
      ' bash "$SIBLING/secret" "$SIBLING/forbidden-write"
)

[[ -f "$WORK/allowed-write" ]]
[[ ! -e "$SIBLING/forbidden-write" ]]

printf 'ok - nono confines Firstmate worker filesystem and environment\n'
