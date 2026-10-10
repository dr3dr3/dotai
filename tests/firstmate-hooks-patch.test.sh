#!/usr/bin/env bash
# firstmate-hooks-patch.sh: set-aside only our exact patch; apply is idempotent.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
P="$ROOT/scripts/firstmate-hooks-patch.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAIL: $*"; exit 1; }

R="$TMP/fm"; mkdir -p "$R/.codex"
cat > "$R/.codex/hooks.json" <<'J'
{"hooks":{"Stop":[{"hooks":[{"type":"command","command":"bash -lc 'echo stop'"}]}],
 "PreToolUse":[{"hooks":[{"type":"command","command":"bash -lc 'echo pre'"}]}]}}
J
echo readme > "$R/README.md"
git -C "$R" init -q && git -C "$R" add -A && git -C "$R" -c user.email=t@t -c user.name=t commit -qm init

"$P" set-aside "$R" || fail "a clean checkout must pass set-aside"
"$P" apply "$R"
grep -q "bash -lc" "$R/.codex/hooks.json" && fail "apply left a login shell"
[ "$(grep -c "bash -c '" "$R/.codex/hooks.json")" = 2 ] || fail "apply did not convert both hooks"
cp "$R/.codex/hooks.json" "$TMP/once"; "$P" apply "$R"; cmp -s "$TMP/once" "$R/.codex/hooks.json" || fail "apply is not idempotent"
echo "  ok  apply converts every hook to bash -c, idempotently"

"$P" set-aside "$R" || fail "our exact patch must be set aside"
[ -z "$(git -C "$R" status --porcelain)" ] || fail "set-aside did not restore the committed file"
echo "  ok  set-aside undoes exactly our patch"

"$P" apply "$R"; sed -i 's/echo stop/echo other/' "$R/.codex/hooks.json"
cp "$R/.codex/hooks.json" "$TMP/other"
if "$P" set-aside "$R"; then fail "a different hooks.json edit must refuse"; fi
cmp -s "$TMP/other" "$R/.codex/hooks.json" || fail "a refused set-aside must not touch the file"
echo "  ok  any other hooks.json edit refuses and is left alone"

git -C "$R" checkout -q -- .codex/hooks.json; "$P" apply "$R"; echo more >> "$R/README.md"
if "$P" set-aside "$R"; then fail "our patch plus another changed file must refuse"; fi
echo "  ok  our patch plus any other change refuses"

# Real-world control: upstream's committed hooks.json, patched, must equal the
# hand-made 2026-10-05 fix (when this checkout exists here).
FM=/workspace/firstmate
if [ -d "$FM/.git" ] && [ -f "$FM/.codex/hooks.json" ]; then
  git -C "$FM" show HEAD:.codex/hooks.json | sed "s/bash -lc '/bash -c '/g" > "$TMP/expected"
  if [ "$(git -C "$FM" status --porcelain)" = " M .codex/hooks.json" ]; then
    cmp -s "$TMP/expected" "$FM/.codex/hooks.json" || fail "patch differs from the live hand-made fix"
    echo "  ok  patched upstream hooks.json == the live 2026-10-05 fix"
  fi
fi
echo "firstmate-hooks-patch: all assertions passed"
