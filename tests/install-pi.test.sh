#!/usr/bin/env bash
# tests/install-pi.test.sh — scripts/install-pi.sh, with npm stubbed.
# The point: pi lives in ~/.local (the persistent home volume), pinned, so a
# devcontainer rebuild can't remove it. A pi elsewhere on PATH (the image's
# global npm tree, which a rebuild wipes) must not count as installed.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail=0
ok()  { echo "  ok   $1"; }
bad() { echo "  FAIL $1" >&2; fail=1; }

mkdir -p "$TMP/bin" "$TMP/sys"
# npm stub: records its args; on install, writes the package.json the real one would.
cat > "$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$NPM_LOG"
prefix=""; pkg=""
while [ $# -gt 0 ]; do case "$1" in --prefix) prefix="$2"; shift 2 ;; @earendil-works/*) pkg="$1"; shift ;; *) shift ;; esac; done
[ -n "$prefix" ] && [ -n "$pkg" ] || exit 0
ver="${pkg##*@}"; d="$prefix/lib/node_modules/@earendil-works/pi-coding-agent"
mkdir -p "$d" "$prefix/bin"; printf '{"name":"@earendil-works/pi-coding-agent","version":"%s"}\n' "$ver" > "$d/package.json"
printf '#!/usr/bin/env bash\necho %s\n' "$ver" > "$prefix/bin/pi"; chmod +x "$prefix/bin/pi"
EOF
chmod +x "$TMP/bin/npm"
# A pi in the image's global tree — present on PATH, but not in ~/.local.
printf '#!/usr/bin/env bash\necho 1.0.2\n' > "$TMP/sys/pi"; chmod +x "$TMP/sys/pi"

run() { # case-name, then env assignments → output in $TMP/out
  local home="$TMP/home-$1"; shift
  mkdir -p "$home"; : > "$TMP/npm.log"
  env -i PATH="$TMP/bin:$TMP/sys:/usr/bin:/bin" HOME="$home" NPM_LOG="$TMP/npm.log" "$@" \
    bash "$ROOT/scripts/install-pi.sh" > "$TMP/out" 2>&1
}

echo "install-pi: a pi outside ~/.local does not count"
run fresh
grep -q -- '--prefix '"$TMP"'/home-fresh/.local --ignore-scripts @earendil-works/pi-coding-agent@1.0.2' "$TMP/npm.log" \
  && ok "installs into ~/.local, pinned to 1.0.2, with --ignore-scripts" || bad "install args: $(cat "$TMP/npm.log")"

echo "install-pi: already at the pin in ~/.local"
run pinned; : > "$TMP/npm.log"
run pinned
[ ! -s "$TMP/npm.log" ] && ok "no reinstall when ~/.local already has the pinned version" || bad "reinstalled: $(cat "$TMP/npm.log")"

echo "install-pi: a different version in ~/.local is replaced"
run drift DOTAI_PI_VERSION=1.0.1
run drift
grep -q '@earendil-works/pi-coding-agent@1.0.2' "$TMP/npm.log" && ok "a version that differs from the pin is reinstalled at the pin" || bad "drift not corrected: $(cat "$TMP/npm.log")"

echo "install-pi: opt-out and override"
run optout DOTAI_INSTALL_PI=0
[ ! -s "$TMP/npm.log" ] && ok "DOTAI_INSTALL_PI=0 installs nothing" || bad "installed despite opt-out"
run override DOTAI_PI_VERSION=1.1.0
grep -q '@earendil-works/pi-coding-agent@1.1.0' "$TMP/npm.log" && ok "DOTAI_PI_VERSION overrides the pin" || bad "override ignored: $(cat "$TMP/npm.log")"

echo "install-pi: no npm is a warning, not a failure"
mkdir -p "$TMP/nonpm"; ln -sf "$(command -v bash)" "$TMP/nonpm/bash"
if env -i PATH="$TMP/nonpm:/bin" HOME="$TMP/home-nonpm" bash "$ROOT/scripts/install-pi.sh" > "$TMP/out" 2>&1; then
  grep -q 'npm not found' "$TMP/out" && ok "exits 0 and says npm is missing" || bad "no warning: $(cat "$TMP/out")"
else bad "failed without npm"; fi

[ "$fail" -eq 0 ] && echo "install-pi: all assertions passed" || { echo "install-pi: FAILED" >&2; exit 1; }
