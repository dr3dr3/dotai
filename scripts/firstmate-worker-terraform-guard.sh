#!/usr/bin/env bash
# Worker-only Terraform/OpenTofu launcher: static formatting is the sole lane.

set -euo pipefail

TOOL="$(basename "$0")"
REAL_DIR="${ROE_FIRSTMATE_REAL_TOOLCHAIN_DIR:-$HOME/.local/lib/roe-firstmate/toolchains}"
REAL_TOOL="$REAL_DIR/$TOOL"
PERMISSION_NOTE="${ROE_FIRSTMATE_PERMISSION_NOTE:-$HOME/.local/lib/roe-firstmate/permission-note}"

die() {
  printf 'firstmate-worker-terraform-guard: %s\n' "$*" >&2
  exit 1
}

case "$TOOL" in
  terraform|tofu) ;;
  *) die "must be invoked through the terraform or tofu worker launcher" ;;
esac

command_name="${1:-<none>}"
case "$command_name" in
  version|-version|--version)
    [[ -x "$REAL_TOOL" ]] || die "verified $TOOL executable is unavailable"
    exec "$REAL_TOOL" "$@"
    ;;
  fmt)
    shift
    for arg in "$@"; do
      [[ "$arg" == -* ]] \
        || die "workers may format only their current worktree; path arguments are refused"
    done
    [[ -x "$REAL_TOOL" ]] || die "verified $TOOL executable is unavailable"
    exec "$REAL_TOOL" fmt "$@"
    ;;
esac

access=execute
boundary=process
case "$command_name" in
  plan)
    access=plan
    boundary=cloud-authority
    ;;
  apply)
    access=apply
    boundary=cloud-authority
    ;;
esac

if [[ -x "$PERMISSION_NOTE" ]]; then
  if ! ROE_FIRSTMATE_ROLE=worker "$PERMISSION_NOTE" \
    --boundary "$boundary" \
    --access "$access" \
    --resource "$TOOL:$command_name" \
    --reason "Worker attempted a command reserved for the captain/operator lane" \
    --evidence denial >/dev/null 2>&1; then
    printf 'firstmate-worker-terraform-guard: include this denied capability in the worker report\n' >&2
  fi
fi

die "workers may run only '$TOOL fmt' and '$TOOL version'; '$command_name' requires the captain/operator lane"
