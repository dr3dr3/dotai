#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GUARD="$ROOT/scripts/firstmate-worker-terraform-guard.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/bin" "$TMP/real"
ln -s "$GUARD" "$TMP/bin/terraform"

cat >"$TMP/real/terraform" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_TERRAFORM_CALLS"
SH
chmod 0755 "$TMP/real/terraform"

cat >"$TMP/permission-note" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$*" >>"$FAKE_PERMISSION_CALLS"
SH
chmod 0755 "$TMP/permission-note"

export ROE_FIRSTMATE_REAL_TOOLCHAIN_DIR="$TMP/real"
export ROE_FIRSTMATE_PERMISSION_NOTE="$TMP/permission-note"
export FAKE_TERRAFORM_CALLS="$TMP/terraform-calls"
export FAKE_PERMISSION_CALLS="$TMP/permission-calls"

"$TMP/bin/terraform" version
"$TMP/bin/terraform" fmt -check -recursive
grep -Fx "version" "$FAKE_TERRAFORM_CALLS" >/dev/null
grep -Fx "fmt -check -recursive" "$FAKE_TERRAFORM_CALLS" >/dev/null

if "$TMP/bin/terraform" fmt ../sibling >"$TMP/path-output" 2>&1; then
  printf 'expected worker formatting outside the current worktree to fail\n' >&2
  exit 1
fi
grep -F "path arguments are refused" "$TMP/path-output" >/dev/null

for command_name in init validate plan apply destroy import state taint force-unlock; do
  if "$TMP/bin/terraform" "$command_name" >"$TMP/$command_name-output" 2>&1; then
    printf 'expected worker terraform %s to fail\n' "$command_name" >&2
    exit 1
  fi
  grep -F "requires the captain/operator lane" "$TMP/$command_name-output" >/dev/null
done

grep -F -- "--boundary cloud-authority --access plan --resource terraform:plan" \
  "$FAKE_PERMISSION_CALLS" >/dev/null
grep -F -- "--boundary cloud-authority --access apply --resource terraform:apply" \
  "$FAKE_PERMISSION_CALLS" >/dev/null
[[ "$(wc -l <"$FAKE_TERRAFORM_CALLS")" -eq 2 ]]

printf 'ok - Firstmate workers can format Terraform but cannot plan or mutate\n'
