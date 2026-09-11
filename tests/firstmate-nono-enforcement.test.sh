#!/usr/bin/env bash

set -euo pipefail

NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"

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
