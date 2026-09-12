#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/old/scripts" "$TMP/system/bin" "$TMP/new/scripts" "$TMP/real" "$TMP/home/.local/bin"

for path in \
  "$TMP/old/scripts/firstmate-harness-sandbox.sh" \
  "$TMP/new/scripts/firstmate-harness-sandbox.sh" \
  "$TMP/system/bin/codex"; do
  printf '#!/usr/bin/env bash\nexit 0\n' >"$path"
  chmod 0755 "$path"
done

ln -s "$TMP/old/scripts/firstmate-harness-sandbox.sh" "$TMP/home/.local/bin/codex"

# shellcheck source=../scripts/setup-firstmate.sh
source "$ROOT/scripts/setup-firstmate.sh"

HOME="$TMP/home"
PATH="$HOME/.local/bin:$TMP/system/bin:/usr/bin:/bin"
HARNESS_SANDBOX="$TMP/new/scripts/firstmate-harness-sandbox.sh"
REAL_HARNESS_DIR="$TMP/real"

configure_harness_sandbox

[[ "$(readlink -f "$REAL_HARNESS_DIR/codex")" == "$TMP/system/bin/codex" ]]
[[ "$(readlink -f "$HOME/.local/bin/codex")" == "$HARNESS_SANDBOX" ]]

printf 'ok - setup skips old Firstmate wrappers when resolving real harnesses\n'
