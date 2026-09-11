#!/usr/bin/env bash
# Read or change the local Firstmate nono mode. Missing configuration means on.

set -euo pipefail

FM_SANDBOX_MODE_FILE="${ROE_FIRSTMATE_SANDBOX_MODE_FILE:-$HOME/.config/roe-firstmate/sandbox-mode}"

fm_sandbox_mode() {
  local mode
  if [[ ! -e "$FM_SANDBOX_MODE_FILE" ]]; then
    printf 'on\n'
    return 0
  fi

  mode="$(tr -d '[:space:]' <"$FM_SANDBOX_MODE_FILE")"
  case "$mode" in
    on|off) printf '%s\n' "$mode" ;;
    *) return 1 ;;
  esac
}

fm_sandbox_set_mode() {
  local mode="$1" directory temporary
  case "$mode" in
    on|off) ;;
    *) return 1 ;;
  esac

  directory="$(dirname "$FM_SANDBOX_MODE_FILE")"
  install -d -m 0700 "$directory"
  temporary="$(mktemp "$directory/.sandbox-mode.XXXXXX")"
  trap 'rm -f "$temporary"' RETURN
  printf '%s\n' "$mode" >"$temporary"
  chmod 0600 "$temporary"
  mv "$temporary" "$FM_SANDBOX_MODE_FILE"
  trap - RETURN
}

fm_sandbox_main() {
  local command="${1:-status}" mode
  [[ $# -le 1 ]] || {
    printf 'Usage: fm-sandbox on|off|status\n' >&2
    return 2
  }

  case "$command" in
    on)
      fm_sandbox_set_mode on
      printf 'Firstmate nono sandbox: ON\n'
      ;;
    off)
      fm_sandbox_set_mode off
      printf 'Firstmate nono sandbox: OFF\n' >&2
      printf 'WARNING: captains and workers now run with full devcontainer access.\n' >&2
      ;;
    status)
      mode="$(fm_sandbox_mode)" || {
        printf 'Invalid Firstmate sandbox mode in %s; refusing to guess.\n' \
          "$FM_SANDBOX_MODE_FILE" >&2
        return 1
      }
      printf 'Firstmate nono sandbox: %s\n' "${mode^^}"
      printf 'Mode file: %s%s\n' "$FM_SANDBOX_MODE_FILE" \
        "$([[ -e "$FM_SANDBOX_MODE_FILE" ]] || printf ' (default; file absent)')"
      ;;
    *)
      printf 'Usage: fm-sandbox on|off|status\n' >&2
      return 2
      ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  fm_sandbox_main "$@"
fi
