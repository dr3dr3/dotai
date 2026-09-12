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
INFRASTRUCTURE_PROJECT_PATH="${INFRASTRUCTURE_PROJECT_PATH:-/workspace/repos/infrastructure}"
PROJECT_ROOT="${ROE_FIRSTMATE_PROJECT_ROOT:-/workspace/repos}"
# Every RoE application repository is served to a container at /app, so each one
# registers through a protected backing clone that Firstmate may fast-forward
# without moving the branch the shared checkout serves. Keep this list in step
# with the captain nono profiles; tests/firstmate-nono-enforcement.test.sh
# asserts the profiles allow exactly these eight backing clones.
APP_PROJECTS=(
  rock-of-eye-all-in-one-portal
  rock-of-eye-api
  rock-of-eye-client-portal
  rock-of-eye-partner-portal
  rock-of-eye-pms-core
  rock-of-eye-production-core
  rock-of-eye-production-portal
  rock-of-eye-sso
)
# No container serves these, so they register as the checkout itself.
DIRECT_PROJECTS=(ai-context infrastructure local-dev-env)
SKIPPED_PROJECTS=()
REAL_TREEHOUSE_DIR="${ROE_TREEHOUSE_REAL_DIR:-$HOME/.local/lib/roe-firstmate}"
REAL_TREEHOUSE="$REAL_TREEHOUSE_DIR/treehouse"
TREEHOUSE_WRAPPER="$SCRIPT_DIR/treehouse-firstmate-guard.sh"
TREEHOUSE_GUARD="$REAL_TREEHOUSE_DIR/treehouse-guard"
NONO="$REAL_TREEHOUSE_DIR/nono"
NONO_PROFILE_SOURCE="$DOTAI_DIR/firstmate/nono"
NONO_PROFILE_DIR="${NONO_CONFIG_HOME:-$HOME/.config/nono}/profiles"
CODEX_PROFILE_SOURCE="$DOTAI_DIR/firstmate/codex"
CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HARNESS_SANDBOX="$SCRIPT_DIR/firstmate-harness-sandbox.sh"
SANDBOX_MODE_SCRIPT="$SCRIPT_DIR/firstmate-sandbox-mode.sh"
PERMISSION_NOTE_SCRIPT="$SCRIPT_DIR/firstmate-permission-note.sh"
PERMISSION_NOTE="$REAL_TREEHOUSE_DIR/permission-note"
WORKER_TERRAFORM_GUARD_SCRIPT="$SCRIPT_DIR/firstmate-worker-terraform-guard.sh"
WORKER_GUARD_BIN="$REAL_TREEHOUSE_DIR/worker-guard-bin"
REAL_TOOLCHAIN_DIR="$REAL_TREEHOUSE_DIR/toolchains"
REAL_HARNESS_DIR="$REAL_TREEHOUSE_DIR/harnesses"
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

touch_default() {
  local path="$1"
  if [[ ! -e "$path" ]]; then
    umask 077
    : >"$path"
  fi
}

append_project_default() {
  local path="$1" project="$2" value="$3"
  if ! grep -Fq -- "- $project [" "$path" 2>/dev/null; then
    umask 077
    printf '%s\n' "$value" >>"$path"
  fi
}

append_default() {
  local path="$1" value="$2"
  if ! grep -Fqx -- "$value" "$path" 2>/dev/null; then
    umask 077
    printf '%s\n' "$value" >>"$path"
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

install_nono() {
  local os arch target asset checksum tmp actual
  os="$(uname -s)"
  arch="$(uname -m)"
  case "$os-$arch" in
    Linux-x86_64)
      target=x86_64-unknown-linux-gnu
      checksum="$NONO_SHA256_LINUX_AMD64"
      ;;
    Linux-aarch64|Linux-arm64)
      target=aarch64-unknown-linux-gnu
      checksum="$NONO_SHA256_LINUX_ARM64"
      ;;
    Darwin-x86_64)
      target=x86_64-apple-darwin
      checksum="$NONO_SHA256_DARWIN_AMD64"
      ;;
    Darwin-arm64)
      target=aarch64-apple-darwin
      checksum="$NONO_SHA256_DARWIN_ARM64"
      ;;
    *)
      die "unsupported nono platform: $os-$arch"
      ;;
  esac
  asset="nono-v${NONO_VERSION}-${target}.tar.gz"

  if [[ -x "$NONO" ]] && [[ "$("$NONO" --version 2>/dev/null)" == "nono $NONO_VERSION" ]]; then
    return
  fi

  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' RETURN
  curl -fsSL --max-filesize 20000000 \
    "https://github.com/nolabs-ai/nono/releases/download/v${NONO_VERSION}/${asset}" \
    -o "$tmp/$asset"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
  else
    actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
  fi
  [[ "$actual" == "$checksum" ]] || die "nono checksum mismatch for $asset"

  tar -xzf "$tmp/$asset" -C "$tmp"
  [[ -f "$tmp/nono" ]] || die "nono archive did not contain the expected binary"
  mkdir -p "$REAL_TREEHOUSE_DIR"
  install -m 0755 "$tmp/nono" "$NONO"
  rm -rf "$tmp"
  trap - RETURN
}

configure_nono_profiles() {
  local profile
  [[ -d "$NONO_PROFILE_SOURCE" ]] || die "nono profile source is missing"
  install -d -m 0700 "$NONO_PROFILE_DIR"
  for profile in "$NONO_PROFILE_SOURCE"/*.json; do
    install -m 0600 "$profile" "$NONO_PROFILE_DIR/$(basename "$profile")"
  done
  for profile in "$NONO_PROFILE_DIR"/roe-firstmate-*.json; do
    "$NONO" profile validate "$profile" >/dev/null \
      || die "invalid nono profile: $profile"
  done
}

configure_codex_profiles() {
  local profile
  [[ -d "$CODEX_PROFILE_SOURCE" ]] || die "Codex profile source is missing"
  install -d -m 0700 "$CODEX_HOME"
  for profile in "$CODEX_PROFILE_SOURCE"/*.config.toml; do
    python3 -c 'import sys, tomllib; tomllib.load(open(sys.argv[1], "rb"))' "$profile" \
      || die "invalid Codex profile: $profile"
    install -m 0600 "$profile" "$CODEX_HOME/$(basename "$profile")"
  done
}

is_harness_sandbox_launcher() {
  local path="$1"
  [[ "$(basename "$(readlink -f "$path")")" == "firstmate-harness-sandbox.sh" ]]
}

is_worker_terraform_launcher() {
  local path="$1" base
  base="$(basename "$(readlink -f "$path")")"
  [[ "$base" == "firstmate-worker-terraform-guard.sh" || "$base" == "worker-terraform-guard" ]]
}

resolve_real_harness() {
  local harness="$1" candidate
  while IFS= read -r candidate; do
    [[ -x "$candidate" ]] || continue
    is_harness_sandbox_launcher "$candidate" && continue
    readlink -f "$candidate"
    return 0
  done < <(type -aP "$harness" 2>/dev/null | awk '!seen[$0]++')
  return 1
}

resolve_real_tool() {
  local tool="$1" candidate
  while IFS= read -r candidate; do
    [[ -x "$candidate" ]] || continue
    is_worker_terraform_launcher "$candidate" && continue
    readlink -f "$candidate"
    return 0
  done < <(type -aP "$tool" 2>/dev/null | awk '!seen[$0]++')
  return 1
}

configure_operational_launchers() {
  local tool candidate real

  install -d -m 0755 "$REAL_TREEHOUSE_DIR" "$WORKER_GUARD_BIN" "$REAL_TOOLCHAIN_DIR" "$HOME/.local/bin"
  install -m 0755 "$TREEHOUSE_WRAPPER" "$TREEHOUSE_GUARD"
  install -m 0755 "$PERMISSION_NOTE_SCRIPT" "$PERMISSION_NOTE"
  install -m 0755 "$WORKER_TERRAFORM_GUARD_SCRIPT" "$REAL_TREEHOUSE_DIR/worker-terraform-guard"

  ln -sfn "$TREEHOUSE_GUARD" "$HOME/.local/bin/treehouse"
  ln -sfn "$PERMISSION_NOTE" "$HOME/.local/bin/fm-permission-note"
  for tool in terraform tofu; do
    real="$REAL_TOOLCHAIN_DIR/$tool"
    candidate="$(resolve_real_tool "$tool" || true)"
    if [[ -n "$candidate" ]]; then
      ln -sfn "$candidate" "$real"
    elif [[ -L "$real" && ! -e "$real" ]]; then
      rm -f "$real"
    fi
    ln -sfn "$REAL_TREEHOUSE_DIR/worker-terraform-guard" "$WORKER_GUARD_BIN/$tool"
  done
}

configure_harness_sandbox() {
  local harness candidate real
  chmod 0755 "$HARNESS_SANDBOX"
  install -d -m 0755 "$REAL_HARNESS_DIR" "$HOME/.local/bin"

  for harness in claude codex; do
    real="$REAL_HARNESS_DIR/$harness"
    candidate="$(resolve_real_harness "$harness" || true)"
    if [[ -n "$candidate" ]]; then
      ln -sfn "$candidate" "$real"
    fi
    if [[ ! -x "$real" ]] || is_harness_sandbox_launcher "$real"; then
      rm -f "$real"
      if [[ -e "$HOME/.local/bin/$harness" ]] \
        && is_harness_sandbox_launcher "$HOME/.local/bin/$harness"; then
        rm -f "$HOME/.local/bin/$harness"
      fi
      continue
    fi
    ln -sfn "$HARNESS_SANDBOX" "$HOME/.local/bin/$harness"
  done
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

project_source_path() {
  case "$1" in
    "$PILOT_PROJECT_NAME") printf '%s\n' "$PILOT_SOURCE_PATH" ;;
    infrastructure) printf '%s\n' "$INFRASTRUCTURE_PROJECT_PATH" ;;
    *) printf '%s\n' "$PROJECT_ROOT/$1" ;;
  esac
}

project_backing_path() {
  if [[ "$1" == "$PILOT_PROJECT_NAME" ]]; then
    printf '%s\n' "$PILOT_PROJECT_PATH"
    return
  fi
  printf '%s/.treehouse/firstmate-backing/%s\n' "$(project_source_path "$1")" "$1"
}

project_is_skipped() {
  local name="$1" skipped
  for skipped in ${SKIPPED_PROJECTS+"${SKIPPED_PROJECTS[@]}"}; do
    [[ "$skipped" == "$name" ]] && return 0
  done
  return 1
}

# Keep the backing clone invisible to its host checkout without changing a
# tracked .gitignore.
exclude_treehouse() {
  local repo="$1"
  if ! grep -Fxq '.treehouse/' "$repo/.git/info/exclude" 2>/dev/null; then
    printf '%s\n' '.treehouse/' >>"$repo/.git/info/exclude"
  fi
}

# The fleet is not uniform - the platform repos are on master, the shared repos
# on main - so read the default branch from origin instead of assuming either.
default_branch_of() {
  local repo="$1" branch=""
  branch="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>&1)" || branch=""
  if [[ -z "$branch" ]]; then
    git -C "$repo" remote set-head origin --auto >/dev/null
    branch="$(git -C "$repo" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>&1)" || branch=""
  fi
  [[ -n "$branch" ]] || return 1
  printf '%s\n' "${branch#origin/}"
}

configure_backing_clone() {
  local name="$1" source backing source_origin backing_origin branch
  source="$(project_source_path "$name")"
  backing="$(project_backing_path "$name")"

  # A devcontainer need not hold every repo. Record the omission and carry on
  # rather than failing setup, but never register a project without a checkout.
  if [[ ! -d "$source/.git" ]]; then
    SKIPPED_PROJECTS+=("$name")
    printf 'skipping %s: no checkout at %s\n' "$name" "$source"
    return
  fi

  source_origin="$(git -C "$source" remote get-url origin)"
  mkdir -p "$(dirname "$backing")"
  # Firstmate may fast-forward the backing clone; it must never move the branch
  # served at /app.
  exclude_treehouse "$source"

  if [[ ! -d "$backing/.git" ]]; then
    git clone "$source_origin" "$backing"
  fi
  backing_origin="$(git -C "$backing" remote get-url origin)"
  [[ "$backing_origin" == "$source_origin" ]] \
    || die "$name backing clone has unexpected origin: $backing_origin"
  exclude_treehouse "$backing"
  [[ -z "$(git -C "$backing" status --porcelain)" ]] \
    || die "$name backing clone is dirty: $backing"
  git -C "$backing" fetch --quiet origin
  branch="$(default_branch_of "$backing")" \
    || die "cannot determine the default branch for $name: $backing"
  git -C "$backing" switch --quiet "$branch"
  git -C "$backing" merge --quiet --ff-only "origin/$branch"
}

configure_backing_clones() {
  local name
  for name in "${APP_PROJECTS[@]}"; do
    configure_backing_clone "$name"
  done
}

# An earlier setup registered an application project as the shared checkout
# itself. Repointing it at the backing clone is only safe while no task metadata
# can still name the old path, so refuse rather than move it under a live task.
relink_project_to_backing() {
  local name="$1" source backing
  local -a existing_meta
  source="$(project_source_path "$name")"
  backing="$(project_backing_path "$name")"
  [[ -L "$FM_HOME/projects/$name" ]] || return 0
  [[ "$(readlink -f "$FM_HOME/projects/$name")" == "$(readlink -f "$source")" ]] || return 0
  [[ "$(readlink -f "$backing")" != "$(readlink -f "$source")" ]] || return 0

  shopt -s nullglob
  existing_meta=("$FM_HOME"/state/*.meta)
  shopt -u nullglob
  (( ${#existing_meta[@]} == 0 )) \
    || die "cannot migrate the $name project link while task metadata exists"
  rm "$FM_HOME/projects/$name"
}

register_project_link() {
  local name="$1" target="$2"
  if [[ ! -e "$FM_HOME/projects/$name" ]]; then
    ln -s "$target" "$FM_HOME/projects/$name"
  fi
  [[ "$(readlink -f "$FM_HOME/projects/$name")" == "$(readlink -f "$target")" ]] \
    || die "$name project link points somewhere unexpected"
}

configure_home() {
  local name source backing
  install -d -m 0700 "$FM_HOME" "$FM_HOME/config" "$FM_HOME/data" "$FM_HOME/state" "$FM_HOME/projects"

  write_default "$FM_HOME/config/backend" "herdr"
  write_default "$FM_HOME/config/herdr-presentation-spaces" "on"
  write_default "$FM_HOME/config/backlog-backend" "manual"
  CHOSEN_HARNESS="$(fm_harness_choose "$FM_HOME")" \
    || die "could not choose Firstmate harness (claude or codex)"

  touch_default "$FM_HOME/data/projects.md"

  for name in "${APP_PROJECTS[@]}"; do
    project_is_skipped "$name" && continue
    backing="$(project_backing_path "$name")"
    [[ -d "$backing/.git" ]] || die "$name project is not a Git checkout: $backing"
    relink_project_to_backing "$name"
    register_project_link "$name" "$backing"
    append_project_default "$FM_HOME/data/projects.md" "$name" \
      "- $name [direct-PR] - RoE application repository; validate committed branches through local-dev-env stage-worktree"
  done

  for name in "${DIRECT_PROJECTS[@]}"; do
    source="$(project_source_path "$name")"
    if [[ ! -d "$source/.git" ]]; then
      SKIPPED_PROJECTS+=("$name")
      printf 'skipping %s: no checkout at %s\n' "$name" "$source"
      continue
    fi
    register_project_link "$name" "$source"
  done

  append_project_default "$FM_HOME/data/projects.md" ai-context \
    "- ai-context [direct-PR] - shared RoE conventions, references, and architecture decision records"
  append_project_default "$FM_HOME/data/projects.md" infrastructure \
    "- infrastructure [direct-PR] - RoE Terraform, alarms, dashboards, and cloud platform configuration"
  append_project_default "$FM_HOME/data/projects.md" local-dev-env \
    "- local-dev-env [direct-PR] - Docker Compose orchestration and validation entry points for the local stack"
  write_default "$FM_HOME/data/backlog.md" $'## In flight\n\n## Queued\n\n## Done'
  touch_default "$FM_HOME/data/permission-needs.jsonl"
  write_default "$FM_HOME/data/captain.md" \
    $'- This is a bounded RoE pilot: no unapproved merge, deploy, release, migration, production-data, payment-state, or destructive authority.\n- Use Treehouse only for editing. Commit before asking the captain to serialize validation through local-dev-env stage-worktree.\n- Never run Composer or Yarn dependency mutation inside a Treehouse worktree.\n- Dispatch at most two local workers; stop on any worktree or staging invariant failure.'
  append_default "$FM_HOME/data/captain.md" \
    "- While nono is off, capture needed capabilities with fm-permission-note; a ledger entry grants and authorizes nothing."
  append_default "$FM_HOME/data/captain.md" \
    "- Infrastructure workers may edit, statically check, and commit Terraform, but never plan, apply, destroy, import, or mutate state."
  append_default "$FM_HOME/data/captain.md" \
    "- Terraform plan/apply must follow dotai's terraform-authority-lane.md: exact revision and workspace, explicit plan permission, fresh post-merge plan, then a separate human-approved apply through the repository's established gate."
  append_default "$FM_HOME/data/captain.md" \
    "- Never plan from a worker checkout; CLI plans use a clean exact-SHA worktree on canonical /workspace/infrastructure tooling."
}

main() {
  local herdr_version
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  command -v herdr >/dev/null 2>&1 || die "Herdr is required; install it through personal dotfiles"
  herdr_version="$(herdr --version 2>&1)"
  version_at_least "$herdr_version" "$HERDR_MIN_VERSION" \
    || die "Herdr $HERDR_MIN_VERSION or newer is required (found: $herdr_version)"

  configure_firstmate_clone
  install_treehouse
  install_nono
  configure_nono_profiles
  configure_codex_profiles
  chmod 0755 \
    "$TREEHOUSE_WRAPPER" \
    "$SANDBOX_MODE_SCRIPT" \
    "$PERMISSION_NOTE_SCRIPT" \
    "$WORKER_TERRAFORM_GUARD_SCRIPT"
  configure_operational_launchers
  ln -sfn "$SCRIPT_DIR/firstmate-local.sh" "$HOME/.local/bin/fm"
  ln -sfn "$SANDBOX_MODE_SCRIPT" "$HOME/.local/bin/fm-sandbox"
  install_firstmate_tools
  configure_harness_sandbox
  configure_git_credentials
  configure_backing_clones
  configure_home

  printf 'Firstmate pilot configured.\n'
  printf '  upstream: %s @ %s\n' "$FIRSTMATE_DIR" "$FIRSTMATE_COMMIT"
  printf '  FM_HOME:  %s\n' "$FM_HOME"
  printf '  backend:  herdr %s\n' "$herdr_version"
  printf '  harness:  %s (captain + crew)\n' "${CHOSEN_HARNESS:-unknown}"
  printf '  treehouse: %s\n' "$("$HOME/.local/bin/treehouse" --version)"
  printf '  nono:     %s (Landlock required)\n' "$("$NONO" --version)"
  printf '  fm:        %s\n' "$HOME/.local/bin/fm"
  printf '  toggle:    %s on|off|status\n' "$HOME/.local/bin/fm-sandbox"
  printf '  ledger:    %s\n' "$FM_HOME/data/permission-needs.jsonl"
  printf '  projects:  %s\n' "$(find "$FM_HOME/projects" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' ')"
  if (( ${#SKIPPED_PROJECTS[@]} )); then
    printf '  skipped:   %s (no checkout under %s)\n' "${SKIPPED_PROJECTS[*]}" "$PROJECT_ROOT"
  fi
  printf 'Run: fm --check\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
