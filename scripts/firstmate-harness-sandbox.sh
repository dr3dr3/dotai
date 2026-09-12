#!/usr/bin/env bash
# Apply the pinned nono boundary to Firstmate captains and Treehouse workers.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")" && pwd)"
# shellcheck source=../firstmate/pins.env
source "$SCRIPT_DIR/../firstmate/pins.env"
# shellcheck source=firstmate-sandbox-mode.sh
source "$SCRIPT_DIR/firstmate-sandbox-mode.sh"

HARNESS="$(basename "$0")"
NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
REAL_DIR="${ROE_FIRSTMATE_REAL_HARNESS_DIR:-$HOME/.local/lib/roe-firstmate/harnesses}"
REAL_HARNESS="$REAL_DIR/$HARNESS"
PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"
ROLE=""

die() {
  printf 'firstmate-harness-sandbox: %s\n' "$*" >&2
  exit 1
}

case "$HARNESS" in
  claude|codex) ;;
  *) die "must be invoked through the claude or codex launcher link" ;;
esac

[[ -x "$REAL_HARNESS" ]] || die "real $HARNESS executable missing at $REAL_HARNESS"
[[ "$(readlink -f "$REAL_HARNESS")" != "$(readlink -f "$0")" ]] \
  || die "real $HARNESS executable resolves back to the sandbox launcher"

if [[ "${ROE_FIRSTMATE_CAPTAIN:-0}" == 1 ]]; then
  [[ "$(pwd -P)/" == /workspace/firstmate/ ]] \
    || die "captain sandbox must start from /workspace/firstmate"
  ROLE=captain
elif [[ "$(pwd -P)/" == /workspace/repos/*/.treehouse/*/ ]]; then
  REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
    || die "worker sandbox must start inside a Treehouse Git checkout"
  [[ -f "$REPO_ROOT/.git" ]] \
    || die "worker sandbox refuses the Treehouse backing primary checkout"
  ROLE=worker
elif [[ "${ROE_FIRSTMATE_SANDBOX_REQUIRED:-0}" == 1 ]]; then
  die "sandbox-required launch is outside a recognized captain or Treehouse path"
else
  exec "$REAL_HARNESS" "$@"
fi

SANDBOX_MODE="$(fm_sandbox_mode)" \
  || die "invalid sandbox mode in $FM_SANDBOX_MODE_FILE; run fm-sandbox on or off"

# Codex's default workspace-write sandbox starts bubblewrap, but this
# devcontainer cannot create the required unprivileged namespace. Select
# Codex's no-inner-sandbox mode for every recognized Firstmate process. When
# nono is on it remains the outer boundary; when nono is off this is the
# explicitly requested unsandboxed pilot mode. Codex's approval policy remains
# unchanged in both cases.
HARNESS_ARGS=()
if [[ "$HARNESS" == codex ]]; then
  HARNESS_ARGS=(--sandbox danger-full-access)
fi

if [[ "$SANDBOX_MODE" == off ]]; then
  printf '\nWARNING: Firstmate nono sandbox is OFF; running %s %s unsandboxed.\n\n' \
    "$HARNESS" "$ROLE" >&2
  unset ROE_FIRSTMATE_CAPTAIN ROE_FIRSTMATE_SANDBOX_REQUIRED
  exec "$REAL_HARNESS" "${HARNESS_ARGS[@]}" "$@"
fi

if [[ "$ROLE" == worker ]]; then
  while IFS= read -r secret_path; do
    if git -C "$REPO_ROOT" ls-files --error-unmatch \
      "${secret_path#"$REPO_ROOT"/}" >/dev/null 2>&1; then
      continue
    fi
    case "$(basename "$secret_path")" in
      .env.example|.env.*.example) continue ;;
      *) die "worker checkout contains a local environment file: $secret_path" ;;
    esac
  done < <(find "$REPO_ROOT" -type f \( -name '.env' -o -name '.env.*' \) -print)
fi

[[ -x "$NONO" ]] || die "pinned nono binary missing; run setup-firstmate.sh"
[[ "$("$NONO" --version 2>/dev/null)" == "nono $NONO_VERSION" ]] \
  || die "nono is not at the reviewed pin $NONO_VERSION"

PROFILE="roe-firstmate-${HARNESS}-${ROLE}"
[[ -f "$PROFILE_DIR/$PROFILE.json" ]] \
  || die "nono profile missing: $PROFILE_DIR/$PROFILE.json"

unset ROE_FIRSTMATE_CAPTAIN ROE_FIRSTMATE_SANDBOX_REQUIRED
export NONO_NO_MIGRATE=1

exec "$NONO" run --profile "$PROFILE" --allow-cwd -- \
  "$REAL_HARNESS" "${HARNESS_ARGS[@]}" "$@"
