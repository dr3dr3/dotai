#!/usr/bin/env bash
#
# Claude Code's native build is wired through an exec-time resolver, not a
# setup-time symlink, because the version is in the executable's path and the
# installer keeps every build. A captured symlink goes stale silently on the
# next self-update: 2.1.260 was served for two weeks with 2.1.283 already on
# disk, and `claude update` reported success throughout.
#
# The load-bearing assertion is "a build that appears AFTER setup ran is picked
# up with no second setup run". Revert configure_harness_sandbox to
# `ln -sfn "$candidate" "$real"` and that one reddens while everything else
# stays green — which is exactly how the original bug hid.
#
# Run: bash tests/firstmate-claude-resolver.test.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/new/scripts" "$TMP/system/bin" "$TMP/real" \
         "$TMP/home/.local/bin" "$TMP/home/.local/share/claude/versions"

VERSIONS="$TMP/home/.local/share/claude/versions"

printf '#!/usr/bin/env bash\nexit 0\n' >"$TMP/new/scripts/firstmate-harness-sandbox.sh"
chmod 0755 "$TMP/new/scripts/firstmate-harness-sandbox.sh"

# Fake native builds that announce which one ran.
make_build() {
  printf '#!/usr/bin/env bash\nprintf "%%s\\n" "%s"\n' "$1" >"$VERSIONS/$1"
  chmod 0755 "$VERSIONS/$1"
}
make_build 2.1.260
make_build 2.1.285

# shellcheck source=../scripts/setup-firstmate.sh
source "$ROOT/scripts/setup-firstmate.sh"

HOME="$TMP/home"
PATH="$HOME/.local/bin:$TMP/system/bin:/usr/bin:/bin"
HARNESS_SANDBOX="$TMP/new/scripts/firstmate-harness-sandbox.sh"
REAL_HARNESS_DIR="$TMP/real"

# A stale pin, exactly as found in the wild: a symlink INTO versions/.
ln -s "$VERSIONS/2.1.260" "$REAL_HARNESS_DIR/claude"

configure_harness_sandbox

# 1. The pin is now a real file, not a symlink into versions/.
[[ -f "$REAL_HARNESS_DIR/claude" && ! -L "$REAL_HARNESS_DIR/claude" ]]
[[ -x "$REAL_HARNESS_DIR/claude" ]]

# 2. Replacing the stale symlink must not have written through it. `cat >`
#    follows a symlink, so without an `rm -f` first this shim would have
#    overwritten the 240 MB build it pointed at.
[[ "$("$VERSIONS/2.1.260")" == "2.1.260" ]]

# 3. It resolves to the newest build, not the one the stale pin named.
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.285" ]]

# 4. PATH still goes through the sandbox launcher.
[[ "$(readlink -f "$HOME/.local/bin/claude")" == "$HARNESS_SANDBOX" ]]

# 5. THE REGRESSION. A build installed after setup ran is picked up on the
#    next launch, with no second setup run. This is the whole point.
make_build 2.1.290
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.290" ]]

# 6. Ordering is numeric, not lexical: "2.1.9" sorts after "2.1.10" as a
#    string, which would serve an older build while looking correct.
make_build 2.1.9
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.290" ]]
rm -f "$VERSIONS"/2.1.2*
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.9" ]]
make_build 2.1.10
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.10" ]]

# 7. No native build at all → the resolver is removed and the old behaviour
#    stands, so an absent claude is still cleaned up rather than left behind
#    claiming to be installed.
rm -f "$VERSIONS"/*
configure_harness_sandbox
[[ ! -e "$REAL_HARNESS_DIR/claude" ]]
[[ ! -e "$HOME/.local/bin/claude" ]]

# 8. The resolver says what to do when it finds nothing, rather than failing
#    with a bare "No such file".
make_build 2.1.285
configure_harness_sandbox
rm -f "$VERSIONS"/*
out="$("$REAL_HARNESS_DIR/claude" 2>&1 || true)"
grep -q 'no native build' <<<"$out"
grep -q 'claude.ai/install.sh' <<<"$out"

# 9. The build runs under the name `claude`. Herdr recognises an agent by its
#    process name (comm), which Linux takes from the basename of the path
#    passed to exec. Exec'ing versions/<ver> directly names the process
#    "2.1.296", so Herdr listed no agents and every pane read `unknown`.
#    A build that reports the basename it was invoked by stands in for comm.
make_named_build() {
  printf '#!/usr/bin/env bash\nbasename "$0"\n' >"$VERSIONS/$1"
  chmod 0755 "$VERSIONS/$1"
}
make_named_build 2.1.300
[[ "$("$REAL_HARNESS_DIR/claude")" == "claude" ]]

# 10. The name link is per version and never repointed, so two launches
#     cannot race, and a newer build gets a new link on its first launch.
NAMED="$HOME/.local/share/claude/dotai-named"
[[ "$(readlink "$NAMED/2.1.300/claude")" == "$VERSIONS/2.1.300" ]]
make_named_build 2.1.301
[[ "$("$REAL_HARNESS_DIR/claude")" == "claude" ]]
[[ "$(readlink "$NAMED/2.1.301/claude")" == "$VERSIONS/2.1.301" ]]

# 11. When the link cannot be made (inside the nono sandbox the share dir is
#     read-only) the build still runs, directly, exactly as before this fix.
rm -rf "$NAMED"
mkdir -p "$NAMED"
chmod 0555 "$NAMED"
[[ "$("$REAL_HARNESS_DIR/claude")" == "2.1.301" ]]
chmod 0755 "$NAMED"

printf 'ok - claude resolves the newest native build at exec time\n'
