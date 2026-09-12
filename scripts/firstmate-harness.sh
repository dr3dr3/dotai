#!/usr/bin/env bash
# Resolve and persist the local Firstmate captain + crew harness pin.
# Sourced by setup-firstmate.sh and firstmate-local.sh. Not executed.

fm_harness_normalize() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|claude|claude-code) printf 'claude\n' ;;
    2|codex) printf 'codex\n' ;;
    *) return 1 ;;
  esac
}

fm_harness_read_file() {
  local path="$1" value=""
  [[ -f "$path" ]] || return 1
  value="$(tr -d '[:space:]' <"$path" || true)"
  [[ -n "$value" ]] || return 1
  fm_harness_normalize "$value"
}

fm_harness_current() {
  local home="${1:-${FM_HOME:-}}"
  [[ -n "$home" ]] || return 1
  fm_harness_read_file "$home/config/captain-harness" \
    || fm_harness_read_file "$home/config/crew-harness" \
    || return 1
}

fm_harness_write() {
  local home="$1" harness="$2"
  install -d -m 0700 "$home/config"
  umask 077
  printf '%s\n' "$harness" >"$home/config/captain-harness"
  printf '%s\n' "$harness" >"$home/config/crew-harness"
  printf '%s\n' "$harness" >"$home/config/secondmate-harness"
}

# Interactive when stdin is a TTY. Otherwise: FIRSTMATE_HARNESS, then existing
# pin, then claude. An explicit FIRSTMATE_HARNESS always overwrites the pin.
fm_harness_choose() {
  local home="$1"
  local chosen="" current="" prompt_default="1" prompt_label="Claude Code"

  if [[ -n "${FIRSTMATE_HARNESS:-}" ]]; then
    chosen="$(fm_harness_normalize "$FIRSTMATE_HARNESS")" \
      || { printf 'firstmate-harness: FIRSTMATE_HARNESS must be claude or codex (got %s)\n' "$FIRSTMATE_HARNESS" >&2; return 1; }
    fm_harness_write "$home" "$chosen"
    printf '%s\n' "$chosen"
    return 0
  fi

  if current="$(fm_harness_current "$home")"; then
    if [[ "$current" == codex ]]; then
      prompt_default="2"
      prompt_label="Codex"
    fi
  fi

  if [[ -t 0 ]]; then
    printf '\nFirstmate captain and crew harness\n' >&2
    printf '  1) Claude Code\n' >&2
    printf '  2) Codex\n' >&2
    printf 'Choice [1/2, default: %s (%s)]: ' "$prompt_default" "$prompt_label" >&2
    local reply=""
    IFS= read -r reply || true
    if [[ -z "$reply" ]]; then
      chosen="$(fm_harness_normalize "$prompt_default")"
    else
      chosen="$(fm_harness_normalize "$reply")" \
        || { printf 'firstmate-harness: enter 1 (claude) or 2 (codex)\n' >&2; return 1; }
    fi
    fm_harness_write "$home" "$chosen"
    printf '%s\n' "$chosen"
    return 0
  fi

  if [[ -n "$current" ]]; then
    printf '%s\n' "$current"
    return 0
  fi

  fm_harness_write "$home" "claude"
  printf 'claude\n'
}
