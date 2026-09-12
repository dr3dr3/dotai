#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/home/.local/bin" "$TMP/system/bin"
cat >"$TMP/system/bin/terraform" <<'SH'
#!/usr/bin/env bash
exit 0
SH
chmod 0755 "$TMP/system/bin/terraform"

# shellcheck source=../scripts/setup-firstmate.sh
source "$ROOT/scripts/setup-firstmate.sh"

HOME="$TMP/home"
PATH="$HOME/.local/bin:$TMP/system/bin:/usr/bin:/bin"
REAL_TREEHOUSE_DIR="$TMP/lib"
TREEHOUSE_GUARD="$REAL_TREEHOUSE_DIR/treehouse-guard"
PERMISSION_NOTE="$REAL_TREEHOUSE_DIR/permission-note"
WORKER_GUARD_BIN="$REAL_TREEHOUSE_DIR/worker-guard-bin"
REAL_TOOLCHAIN_DIR="$REAL_TREEHOUSE_DIR/toolchains"

configure_operational_launchers

[[ "$(readlink -f "$HOME/.local/bin/treehouse")" == "$TREEHOUSE_GUARD" ]]
[[ "$(readlink -f "$HOME/.local/bin/fm-permission-note")" == "$PERMISSION_NOTE" ]]
[[ "$(readlink -f "$REAL_TOOLCHAIN_DIR/terraform")" == "$TMP/system/bin/terraform" ]]
[[ ! -e "$REAL_TOOLCHAIN_DIR/tofu" ]]
[[ "$(readlink -f "$WORKER_GUARD_BIN/terraform")" == "$REAL_TREEHOUSE_DIR/worker-terraform-guard" ]]
[[ "$(readlink -f "$WORKER_GUARD_BIN/tofu")" == "$REAL_TREEHOUSE_DIR/worker-terraform-guard" ]]

printf 'ok - operational launchers use stable installed paths\n'
