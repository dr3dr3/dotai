#!/usr/bin/env bash
# install-pi.sh — install the Pi Harness into ~/.local, pinned.
#
# Why ~/.local: a devcontainer rebuild keeps ~/.local (the home volume) but
# wipes the image's global npm tree. On 2026-10-07 the first live
# `make second-review` found pi missing because it lived in nvm's global prefix
# (installed by the devcontainer image), the same failure Claude Code had.
# So a pi anywhere else on PATH does NOT count as installed: only the package
# under ~/.local, at the pinned version.
#
# Why pinned: second-review and the Firstmate crew depend on pi's CLI and its
# `--mode json` event stream. A floating version can change those under them.
# 1.0.2 is what ran the first live review. Bump DOTAI_PI_VERSION deliberately.
#
# Env:
#   DOTAI_INSTALL_PI=0       skip (default: install)
#   DOTAI_PI_VERSION=x.y.z   pin (default 1.0.2)
#   NPM_HOME_PREFIX          install prefix (default $HOME/.local)
#
# Installed with --ignore-scripts per the vendor docs (https://pi.dev/docs).
# Exit 0 always: a missing npm or a failed install is reported, never fatal to
# the rest of setup.
set -uo pipefail

PKG="@earendil-works/pi-coding-agent"
VERSION="${DOTAI_PI_VERSION:-1.0.2}"
PREFIX="${NPM_HOME_PREFIX:-$HOME/.local}"

if [ "${DOTAI_INSTALL_PI:-1}" = "0" ]; then
  echo "  (Pi skipped — DOTAI_INSTALL_PI=0)"
  exit 0
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "⚠ npm not found — cannot install Pi (install Node, then re-run)."
  exit 0
fi

installed_version() {
  local pj="$PREFIX/lib/node_modules/$PKG/package.json"
  [ -f "$pj" ] || return 1
  python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$pj" 2>/dev/null \
    || sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pj"
}

have="$(installed_version || true)"
if [ "$have" = "$VERSION" ]; then
  echo "✓ Pi $VERSION already installed in $PREFIX — skipping."
  exit 0
fi
if [ -n "$have" ]; then
  echo "→ Pi $have in $PREFIX differs from the pin $VERSION — reinstalling."
else
  echo "→ Installing Pi $VERSION into $PREFIX (a pi elsewhere on PATH doesn't survive a rebuild)..."
fi
if npm install -g --prefix "$PREFIX" --ignore-scripts "$PKG@$VERSION"; then
  echo "✓ Pi $VERSION installed in $PREFIX"
else
  echo "⚠ Pi install failed — install manually: npm install -g --prefix \"$PREFIX\" --ignore-scripts $PKG@$VERSION"
fi
exit 0
