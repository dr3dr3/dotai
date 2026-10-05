#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Load only the helper: setup.sh performs installation work when sourced.
sed -n '/^ensure_codex_project_doc_settings()/,/^}/p' "$ROOT/scripts/setup.sh" \
  >"$TMP/codex-config-helper.sh"
# shellcheck disable=SC1091
source "$TMP/codex-config-helper.sh"

config="$TMP/config.toml"
cat >"$config" <<'TOML'
model = "gpt-6-sol"
project_doc_fallback_filenames = ["CLAUDE.md"]
project_doc_max_bytes = 262144

[features]
hooks = true
TOML

before="$(sha256sum "$config")"
if ensure_codex_project_doc_settings "$config"; then
  printf 'already-complete config must not be rewritten\n' >&2
  exit 1
fi
[[ "$(sha256sum "$config")" == "$before" ]]

cat >"$config" <<'TOML'
model = "gpt-6-sol"
project_doc_fallback_filenames = ["CLAUDE.md"]
project_doc_max_bytes = 262144
project_doc_fallback_filenames = ["CLAUDE.md"]
project_doc_max_bytes = 262144

[features]
hooks = true
TOML

ensure_codex_project_doc_settings "$config"
[[ "$(grep -c '^project_doc_fallback_filenames = ' "$config")" == 1 ]]
[[ "$(grep -c '^project_doc_max_bytes = ' "$config")" == 1 ]]
if ensure_codex_project_doc_settings "$config"; then
  printf 'deduplicated config must remain stable\n' >&2
  exit 1
fi

cat >"$config" <<'TOML'
model = "gpt-6-sol"

[features]
hooks = true
TOML

ensure_codex_project_doc_settings "$config"
[[ "$(grep -c '^project_doc_fallback_filenames = ' "$config")" == 1 ]]
[[ "$(grep -c '^project_doc_max_bytes = ' "$config")" == 1 ]]
[[ "$(grep -n '^project_doc_max_bytes = ' "$config" | cut -d: -f1)" -lt \
   "$(grep -n '^\[features\]' "$config" | cut -d: -f1)" ]]

if ensure_codex_project_doc_settings "$config"; then
  printf 'second normalization must be idempotent\n' >&2
  exit 1
fi

printf 'ok - Codex project-doc settings stay unique at the TOML root\n'
