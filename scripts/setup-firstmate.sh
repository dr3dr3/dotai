#!/usr/bin/env bash
# Install and configure the bounded RoE Firstmate pilot.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOTAI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=../firstmate/pins.env
source "$DOTAI_DIR/firstmate/pins.env"
# shellcheck source=firstmate-harness.sh
source "$SCRIPT_DIR/firstmate-harness.sh"

FIRSTMATE_DIR="${FIRSTMATE_DIR:-/workspace/firstmate}"
FM_HOME="${FM_HOME:-/workspace/.firstmate-home}"
PILOT_PROJECT_NAME="${PILOT_PROJECT_NAME:-rock-of-eye-api}"
PILOT_SOURCE_PATH="${PILOT_SOURCE_PATH:-/workspace/repos/rock-of-eye-api}"
PILOT_PROJECT_PATH="${PILOT_PROJECT_PATH:-$PILOT_SOURCE_PATH/.treehouse/firstmate-backing/$PILOT_PROJECT_NAME}"
REAL_TREEHOUSE_DIR="${ROE_TREEHOUSE_REAL_DIR:-$HOME/.local/lib/roe-firstmate}"
REAL_TREEHOUSE="$REAL_TREEHOUSE_DIR/treehouse"
TREEHOUSE_WRAPPER="$SCRIPT_DIR/treehouse-firstmate-guard.sh"
INSTALL_FIRSTMATE_TOOLS="${INSTALL_FIRSTMATE_TOOLS:-1}"
CHOSEN_HARNESS=""

die() {
  printf 'setup-firstmate: %s\n' "$*" >&2
  exit 1
}

version_at_least() {
  python3 - "$1" "$2" <<'PY'
import re
import sys

def version(value):
    match = re.search(r"(\d+)\.(\d+)\.(\d+)", value)
    if not match:
        raise SystemExit(2)
    return tuple(map(int, match.groups()))

raise SystemExit(0 if version(sys.argv[1]) >= version(sys.argv[2]) else 1)
PY
}

write_default() {
  local path="$1" value="$2"
  if [[ ! -e "$path" ]]; then
    umask 077
    printf '%s\n' "$value" >"$path"
  fi
}

install_treehouse() {
  local os arch asset checksum tmp actual
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os-$arch" in
    Linux-x86_64)
      asset="treehouse-v${TREEHOUSE_VERSION}-linux-amd64.tar.gz"
      checksum="$TREEHOUSE_SHA256_LINUX_AMD64"
      ;;
    Linux-aarch64|Linux-arm64)
      asset="treehouse-v${TREEHOUSE_VERSION}-linux-arm64.tar.gz"
      checksum="$TREEHOUSE_SHA256_LINUX_ARM64"
      ;;
    Darwin-x86_64)
      asset="treehouse-v${TREEHOUSE_VERSION}-darwin-amd64.tar.gz"
      checksum="$TREEHOUSE_SHA256_DARWIN_AMD64"
      ;;
    Darwin-arm64)
      asset="treehouse-v${TREEHOUSE_VERSION}-darwin-arm64.tar.gz"
      checksum="$TREEHOUSE_SHA256_DARWIN_ARM64"
      ;;
    *)
      die "unsupported Treehouse platform: $os-$arch"
      ;;
  esac

  if [[ -x "$REAL_TREEHOUSE" ]] \
    && [[ "$("$REAL_TREEHOUSE" --version 2>/dev/null | tr -cd '0-9.')" == "$TREEHOUSE_VERSION" ]]; then
    return
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL --max-filesize 15000000 \
    "https://github.com/kunchenguid/treehouse/releases/download/v${TREEHOUSE_VERSION}/${asset}" \
    -o "$tmp/$asset"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  [[ "$actual" == "$checksum" ]] || die "Treehouse checksum mismatch for $asset"

  tar -xzf "$tmp/$asset" -C "$tmp"
  [[ -f "$tmp/treehouse" ]] || die "Treehouse archive did not contain the expected binary"
  mkdir -p "$REAL_TREEHOUSE_DIR" "$HOME/.local/bin"
  install -m 0755 "$tmp/treehouse" "$REAL_TREEHOUSE"
  rm -rf "$tmp"
  trap - RETURN
}

configure_firstmate_clone() {
  if [[ ! -d "$FIRSTMATE_DIR/.git" ]]; then
    git clone "$FIRSTMATE_REPOSITORY" "$FIRSTMATE_DIR"
  fi

  local origin head
  origin="$(git -C "$FIRSTMATE_DIR" remote get-url origin)"
  [[ "$origin" == "$FIRSTMATE_REPOSITORY" || "$origin" == "https://github.com/kunchenguid/firstmate" ]] \
    || die "$FIRSTMATE_DIR has unexpected origin: $origin"
  [[ -z "$(git -C "$FIRSTMATE_DIR" status --porcelain)" ]] \
    || die "$FIRSTMATE_DIR is dirty; refusing to replace upstream source"

  git -C "$FIRSTMATE_DIR" fetch --quiet origin "$FIRSTMATE_COMMIT"
  head="$(git -C "$FIRSTMATE_DIR" rev-parse HEAD)"
  if [[ "$head" != "$FIRSTMATE_COMMIT" ]]; then
    git -C "$FIRSTMATE_DIR" checkout --quiet --detach "$FIRSTMATE_COMMIT"
  fi
}

install_firstmate_tools() {
  if [[ "$INSTALL_FIRSTMATE_TOOLS" != 1 ]]; then
    return 0
  fi
  command -v npm >/dev/null 2>&1 || die "npm is required to install Firstmate's axi tools"

  if ! command -v no-mistakes >/dev/null 2>&1; then
    curl -fsSL https://raw.githubusercontent.com/kunchenguid/no-mistakes/main/docs/install.sh | bash
  fi

  npm install -g gh-axi chrome-devtools-axi lavish-axi tasks-axi quota-axi
  gh-axi setup hooks
  chrome-devtools-axi setup hooks
  lavish-axi setup hooks
}

configure_git_credentials() {
  command -v gh >/dev/null 2>&1 || die "GitHub CLI is required"
  gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated"
  # A devcontainer can inherit a host-only Homebrew helper path. Let the
  # authenticated Linux gh binary own the helper entry used by crew fetches.
  gh auth setup-git
}

configure_pilot_backing_clone() {
  [[ -d "$PILOT_SOURCE_PATH/.git" ]] || die "pilot source is not a Git checkout: $PILOT_SOURCE_PATH"

  local source_origin backing_origin
  source_origin="$(git -C "$PILOT_SOURCE_PATH" remote get-url origin)"
  mkdir -p "$(dirname "$PILOT_PROJECT_PATH")"

  # Keep the backing clone invisible to the shared checkout without changing a
  # tracked .gitignore. Firstmate may fast-forward this clone; it must never
  # move the branch served at /app.
  if ! grep -Fxq '.treehouse/' "$PILOT_SOURCE_PATH/.git/info/exclude" 2>/dev/null; then
    printf '%s\n' '.treehouse/' >>"$PILOT_SOURCE_PATH/.git/info/exclude"
  fi

  if [[ ! -d "$PILOT_PROJECT_PATH/.git" ]]; then
    git clone "$source_origin" "$PILOT_PROJECT_PATH"
  fi
  backing_origin="$(git -C "$PILOT_PROJECT_PATH" remote get-url origin)"
  [[ "$backing_origin" == "$source_origin" ]] \
    || die "pilot backing clone has unexpected origin: $backing_origin"
  if ! grep -Fxq '.treehouse/' "$PILOT_PROJECT_PATH/.git/info/exclude" 2>/dev/null; then
    printf '%s\n' '.treehouse/' >>"$PILOT_PROJECT_PATH/.git/info/exclude"
  fi
  [[ -z "$(git -C "$PILOT_PROJECT_PATH" status --porcelain)" ]] \
    || die "pilot backing clone is dirty: $PILOT_PROJECT_PATH"
  git -C "$PILOT_PROJECT_PATH" fetch --quiet origin
  git -C "$PILOT_PROJECT_PATH" switch --quiet master
  git -C "$PILOT_PROJECT_PATH" merge --quiet --ff-only origin/master
}

configure_home() {
  [[ -d "$PILOT_PROJECT_PATH/.git" ]] || die "pilot project is not a Git checkout: $PILOT_PROJECT_PATH"
  install -d -m 0700 "$FM_HOME" "$FM_HOME/config" "$FM_HOME/data" "$FM_HOME/state" "$FM_HOME/projects"

  write_default "$FM_HOME/config/backend" "herdr"
  write_default "$FM_HOME/config/herdr-presentation-spaces" "on"
  write_default "$FM_HOME/config/backlog-backend" "manual"
  CHOSEN_HARNESS="$(fm_harness_choose "$FM_HOME")" \
    || die "could not choose Firstmate harness (claude or codex)"

  if [[ -L "$FM_HOME/projects/$PILOT_PROJECT_NAME" ]] \
    && [[ "$(readlink -f "$FM_HOME/projects/$PILOT_PROJECT_NAME")" == "$(readlink -f "$PILOT_SOURCE_PATH")" ]] \
    && [[ "$(readlink -f "$PILOT_PROJECT_PATH")" != "$(readlink -f "$PILOT_SOURCE_PATH")" ]]; then
    shopt -s nullglob
    existing_meta=("$FM_HOME"/state/*.meta)
    shopt -u nullglob
    (( ${#existing_meta[@]} == 0 )) \
      || die "cannot migrate the pilot project link while task metadata exists"
    rm "$FM_HOME/projects/$PILOT_PROJECT_NAME"
  fi
  if [[ ! -e "$FM_HOME/projects/$PILOT_PROJECT_NAME" ]]; then
    ln -s "$PILOT_PROJECT_PATH" "$FM_HOME/projects/$PILOT_PROJECT_NAME"
  fi
  [[ "$(readlink -f "$FM_HOME/projects/$PILOT_PROJECT_NAME")" == "$(readlink -f "$PILOT_PROJECT_PATH")" ]] \
    || die "pilot project link points somewhere unexpected"

  write_default "$FM_HOME/data/projects.md" \
    "- $PILOT_PROJECT_NAME [direct-PR] - RoE API pilot; validate committed branches through local-dev-env stage-worktree (added 2026-09-06)"
  write_default "$FM_HOME/data/backlog.md" $'## In flight\n\n## Queued\n\n## Done'
  write_default "$FM_HOME/data/captain.md" \
    $'- This is a bounded RoE pilot: no merge, deploy, release, migration, production-data, payment-state, or destructive authority.\n- Use Treehouse only for editing. Commit before asking the captain to serialize validation through local-dev-env stage-worktree.\n- Never run Composer or Yarn dependency mutation inside a Treehouse worktree.\n- Dispatch at most two local workers; stop on any worktree or staging invariant failure.'
}

command -v python3 >/dev/null 2>&1 || die "python3 is required"
command -v herdr >/dev/null 2>&1 || die "Herdr is required; install it through personal dotfiles"
herdr_version="$(herdr --version 2>&1)"
version_at_least "$herdr_version" "$HERDR_MIN_VERSION" \
  || die "Herdr $HERDR_MIN_VERSION or newer is required (found: $herdr_version)"

configure_firstmate_clone
install_treehouse
chmod 0755 "$TREEHOUSE_WRAPPER"
mkdir -p "$HOME/.local/bin"
ln -sfn "$TREEHOUSE_WRAPPER" "$HOME/.local/bin/treehouse"
ln -sfn "$SCRIPT_DIR/firstmate-local.sh" "$HOME/.local/bin/fm"
install_firstmate_tools
configure_git_credentials
configure_pilot_backing_clone
configure_home

printf 'Firstmate pilot configured.\n'
printf '  upstream: %s @ %s\n' "$FIRSTMATE_DIR" "$FIRSTMATE_COMMIT"
printf '  FM_HOME:  %s\n' "$FM_HOME"
printf '  backend:  herdr %s\n' "$herdr_version"
printf '  harness:  %s (captain + crew)\n' "${CHOSEN_HARNESS:-unknown}"
printf '  treehouse: %s\n' "$("$HOME/.local/bin/treehouse" --version)"
printf '  fm:        %s\n' "$HOME/.local/bin/fm"
printf 'Run: fm --check\n'
