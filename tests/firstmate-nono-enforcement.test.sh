#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NONO="${ROE_FIRSTMATE_NONO:-$HOME/.local/lib/roe-firstmate/nono}"
PROFILE_DIR="${ROE_FIRSTMATE_NONO_PROFILE_DIR:-$HOME/.config/nono/profiles}"

# Every RoE application repo the captain registers is served from a protected
# backing clone, so the captain profile must allow all eight. Asserted as set
# equality rather than presence: a dropped repo silently blocks a domain, and an
# unexpected one is a grant nobody reviewed.
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
SHARED_PROJECTS=(ai-context infrastructure local-dev-env)

expected_backing="$(for project in "${APP_PROJECTS[@]}"; do
  printf '/workspace/repos/%s/.treehouse/firstmate-backing/%s\n' "$project" "$project"
done | sort)"

# setup-firstmate.sh provisions the backing clones, the captain profiles grant
# access to them, and this list is the contract between the two. Read the setup
# list rather than trusting it, so adding a repo to one place fails here.
setup_projects="$(
  # shellcheck disable=SC1090
  source <(sed -n '/^APP_PROJECTS=(/,/^)/p' "$ROOT/scripts/setup-firstmate.sh")
  printf '%s\n' "${APP_PROJECTS[@]}" | sort
)"
if [[ "$setup_projects" != "$(printf '%s\n' "${APP_PROJECTS[@]}" | sort)" ]]; then
  printf 'setup-firstmate.sh APP_PROJECTS does not match the expected app repo set\n' >&2
  diff <(printf '%s\n' "${APP_PROJECTS[@]}" | sort) <(printf '%s\n' "$setup_projects") >&2 || true
  exit 1
fi

for harness in claude codex; do
  captain="$ROOT/firstmate/nono/roe-firstmate-$harness-captain.json"

  jq -e '.filesystem.allow | index("/workspace/.firstmate-secondmates") != null' \
    "$captain" >/dev/null

  actual_backing="$(jq -r '.filesystem.allow[] | select(test("/.treehouse/firstmate-backing/"))' \
    "$captain" | sort)"
  if [[ "$actual_backing" != "$expected_backing" ]]; then
    printf 'captain profile %s does not allow exactly the eight app backing clones\n' "$captain" >&2
    diff <(printf '%s\n' "$expected_backing") <(printf '%s\n' "$actual_backing") >&2 || true
    exit 1
  fi

  for project in "${SHARED_PROJECTS[@]}"; do
    jq -e --arg path "/workspace/repos/$project" '.filesystem.allow | index($path) != null' \
      "$captain" >/dev/null
  done

  jq -e '(.filesystem.allow | index("/workspace/.firstmate-secondmates")) == null' \
    "$ROOT/firstmate/nono/roe-firstmate-$harness-worker.json" >/dev/null
done

# Claude Code locates its account state through CLAUDE_CONFIG_DIR; the sandbox
# launcher sets it and both Claude profiles must let it through the base
# environment allowlist, or every sandboxed session falls back to a
# ~/.claude.json it cannot reach and re-runs login.
for role in captain worker; do
  jq -e '.environment.allow_vars | index("CLAUDE_CONFIG_DIR") != null' \
    "$ROOT/firstmate/nono/roe-firstmate-claude-$role.json" >/dev/null
done
# The Claude captain (and only the captain) may work in the dotai checkout.
jq -e '.filesystem.allow | index("/workspace/.ai/dotai") != null' \
  "$ROOT/firstmate/nono/roe-firstmate-claude-captain.json" >/dev/null
for profile in "$ROOT"/firstmate/nono/roe-firstmate-*-worker.json \
  "$ROOT"/firstmate/nono/roe-firstmate-{codex,pi}-captain.json; do
  jq -e '(.filesystem.allow | index("/workspace/.ai/dotai")) == null' "$profile" >/dev/null
done

if [[ ! -x "$NONO" ]]; then
  printf 'skip - pinned nono is not installed\n'
  exit 0
fi

"$NONO" setup --check-only >/dev/null

# Firstmate bootstrap execs the four axi tools; they are npm-installed under
# ~/.local/lib/node_modules and symlinked from ~/.local/bin, and Landlock needs
# read on both directories to exec through the link. The adjacent credentials
# must stay denied: ~/.npmrc sits beside node_modules in deny_credentials, and
# ~/.config/gh is the push-capable token README.md forbids granting a captain.
captain="$ROOT/firstmate/nono/roe-firstmate-claude-captain.json"
nono_why_status() {
  "$NONO" why --profile "$captain" --path "$1" --op read --json 2>/dev/null \
    | jq -r '.status'
}
for tool in gh-axi lavish-axi quota-axi tasks-axi; do
  for path in "$HOME/.local/bin/$tool" "$HOME/.local/lib/node_modules/$tool/dist/bin/$tool.js"; do
    if [[ "$(nono_why_status "$path")" != allowed ]]; then
      printf 'captain profile does not allow reading %s\n' "$path" >&2
      exit 1
    fi
  done
done
for path in "$HOME/.npmrc" "$HOME/.config/gh/hosts.yml"; do
  if [[ "$(nono_why_status "$path")" != denied ]]; then
    printf 'captain profile must keep %s denied\n' "$path" >&2
    exit 1
  fi
done

WORK="$(mktemp -d /workspace/repos/.firstmate-nono-work.XXXXXX)"
SIBLING="$(mktemp -d /workspace/repos/.firstmate-nono-sibling.XXXXXX)"
trap 'rm -rf "$WORK" "$SIBLING"' EXIT
printf 'must-not-read\n' >"$SIBLING/secret"

(
  cd "$WORK"
  GH_TOKEN=must-not-leak FM_TEST_MARKER=preserved \
    "$NONO" run --profile roe-firstmate-codex-worker --allow-cwd -- \
      bash -c '
        set -e
        touch allowed-write
        test "$FM_TEST_MARKER" = preserved
        test -z "${GH_TOKEN:-}"
        ! cat "$1" >/dev/null 2>&1
        ! touch "$2" 2>/dev/null
      ' bash "$SIBLING/secret" "$SIBLING/forbidden-write"
)

[[ -f "$WORK/allowed-write" ]]
[[ ! -e "$SIBLING/forbidden-write" ]]

(
  cd "$WORK"
  CLAUDE_CONFIG_DIR="$HOME/.ai/claude" \
    "$NONO" run --profile "$ROOT/firstmate/nono/roe-firstmate-claude-worker.json" --allow-cwd -- \
      bash -c 'test "$CLAUDE_CONFIG_DIR" = "$HOME/.ai/claude"'
)

printf 'ok - nono confines Firstmate worker filesystem and environment\n'
