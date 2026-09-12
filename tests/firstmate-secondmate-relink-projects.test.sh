#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELINK="$ROOT/scripts/firstmate-secondmate-relink-projects.sh"

TMP="$(mktemp -d /tmp/firstmate-relink-test.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

PROJECT_ROOT="$TMP/repos"
PRIMARY_HOME="$TMP/primary-home"
SECOND_MATE="$TMP/secondmate/firstmate"
ORIGINS="$TMP/origins"
BACKUP="$TMP/backup"

# The full RoE application set, so a future change cannot quietly stop covering
# the production repos, plus the shared repos registered as direct checkouts.
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

mkdir -p "$PROJECT_ROOT" "$PRIMARY_HOME/projects" "$SECOND_MATE/projects" "$ORIGINS"
printf 'otel\n' >"$SECOND_MATE/.fm-secondmate-home"

git_quiet() { git -C "$1" -c user.email=test@example.invalid -c user.name=relink "${@:2}"; }

make_origin() {
  local name="$1" seed="$TMP/seed-$1" branch
  git init -q --bare "$ORIGINS/$name.git"
  git init -q "$seed"
  printf '%s\n' "$name" >"$seed/README.md"
  git_quiet "$seed" add README.md
  git_quiet "$seed" commit -qm init
  # Track whatever init.defaultBranch produced and point the bare HEAD at it, so
  # clones check out a real branch with an upstream on any git configuration.
  branch="$(git -C "$seed" rev-parse --abbrev-ref HEAD)"
  git_quiet "$seed" remote add origin "$ORIGINS/$name.git"
  git_quiet "$seed" push -q origin "HEAD:refs/heads/$branch"
  git --git-dir="$ORIGINS/$name.git" symbolic-ref HEAD "refs/heads/$branch"
}

# Backing clone under the project root, registered by the primary home exactly
# the way the guarded arrangement does it.
register_primary() {
  local name="$1" backing="$PROJECT_ROOT/$1/.treehouse/firstmate-backing/$1"
  mkdir -p "$(dirname "$backing")"
  git clone -q "$ORIGINS/$name.git" "$backing"
  ln -s "$backing" "$PRIMARY_HOME/projects/$name"
}

register_primary_direct() {
  local name="$1"
  git clone -q "$ORIGINS/$name.git" "$PROJECT_ROOT/$name"
  ln -s "$PROJECT_ROOT/$name" "$PRIMARY_HOME/projects/$name"
}

# What fm-home-seed.sh actually leaves behind: an independent clone inside the
# secondmate home, off the repository volumes.
seed_secondmate_clone() {
  git clone -q "$ORIGINS/$1.git" "$SECOND_MATE/projects/$1"
}

for name in "${APP_PROJECTS[@]}"; do
  make_origin "$name"
  register_primary "$name"
  seed_secondmate_clone "$name"
done
for name in "${SHARED_PROJECTS[@]}"; do
  make_origin "$name"
  register_primary_direct "$name"
  seed_secondmate_clone "$name"
done

export ROE_FIRSTMATE_PROJECT_ROOT="$PROJECT_ROOT"
export ROE_FIRSTMATE_PRIMARY_HOME="$PRIMARY_HOME"

assert_fails_with() {
  local expected="$1" output
  shift
  if output="$("$@" 2>&1)"; then
    printf 'expected command to fail: %s\n' "$*" >&2
    printf '%s\n' "$output" >&2
    exit 1
  fi
  if [[ "$output" != *"$expected"* ]]; then
    printf 'expected failure containing %q, got:\n%s\n' "$expected" "$output" >&2
    exit 1
  fi
}

# A dry run reports every clone and changes nothing.
dry_output="$("$RELINK" "$SECOND_MATE" --dry-run)"
[[ "$dry_output" == *"dry run: 11 to relink, 0 already linked"* ]]
[[ ! -L "$SECOND_MATE/projects/rock-of-eye-production-core" ]]

# The real run relinks all eleven onto the project root and preserves the clones.
"$RELINK" "$SECOND_MATE" --backup-dir "$BACKUP" >/dev/null
for name in "${APP_PROJECTS[@]}"; do
  [[ -L "$SECOND_MATE/projects/$name" ]] \
    || { printf '%s was not relinked\n' "$name" >&2; exit 1; }
  [[ "$(readlink -f "$SECOND_MATE/projects/$name")" \
    == "$PROJECT_ROOT/$name/.treehouse/firstmate-backing/$name" ]] \
    || { printf '%s points at the wrong target\n' "$name" >&2; exit 1; }
  [[ -d "$BACKUP/$name/.git" ]] \
    || { printf '%s clone was not preserved\n' "$name" >&2; exit 1; }
done
for name in "${SHARED_PROJECTS[@]}"; do
  [[ "$(readlink -f "$SECOND_MATE/projects/$name")" == "$PROJECT_ROOT/$name" ]]
done

# Idempotent: a second run relinks nothing and leaves the links alone.
again="$("$RELINK" "$SECOND_MATE")"
[[ "$again" == *"relinked 0, already linked 11"* ]]
[[ "$(readlink -f "$SECOND_MATE/projects/rock-of-eye-production-portal")" \
  == "$PROJECT_ROOT/rock-of-eye-production-portal/.treehouse/firstmate-backing/rock-of-eye-production-portal" ]]

# A link that resolves off the repository volumes is a refusal, not a rewrite.
STRAY="$TMP/stray-home/firstmate"
mkdir -p "$STRAY/projects"
printf 'stray\n' >"$STRAY/.fm-secondmate-home"
ln -s "$TMP/seed-rock-of-eye-api" "$STRAY/projects/rock-of-eye-api"
assert_fails_with "already a link off the repository volumes" "$RELINK" "$STRAY"

# Unprovable clones refuse, naming the project.
new_secondmate() {
  local home="$TMP/$1/firstmate"
  mkdir -p "$home/projects"
  printf '%s\n' "$1" >"$home/.fm-secondmate-home"
  git clone -q "$ORIGINS/rock-of-eye-production-core.git" "$home/projects/rock-of-eye-production-core"
  printf '%s\n' "$home"
}

DIRTY="$(new_secondmate dirty)"
printf 'local edit\n' >>"$DIRTY/projects/rock-of-eye-production-core/README.md"
assert_fails_with "rock-of-eye-production-core has uncommitted changes" "$RELINK" "$DIRTY"

AHEAD="$(new_secondmate ahead)"
printf 'committed locally\n' >>"$AHEAD/projects/rock-of-eye-production-core/README.md"
git_quiet "$AHEAD/projects/rock-of-eye-production-core" commit -qam "local only"
assert_fails_with "has 1 unpushed commit(s)" "$RELINK" "$AHEAD"

STASHED="$(new_secondmate stashed)"
printf 'stash me\n' >>"$STASHED/projects/rock-of-eye-production-core/README.md"
git_quiet "$STASHED/projects/rock-of-eye-production-core" stash -q
assert_fails_with "has stashed changes" "$RELINK" "$STASHED"

UNKNOWN="$(new_secondmate unknown)"
git clone -q "$ORIGINS/rock-of-eye-api.git" "$UNKNOWN/projects/not-registered"
assert_fails_with "not registered in the primary home" "$RELINK" "$UNKNOWN"

# The secondmate marker is what stops this from stripping the primary home.
assert_fails_with "not a secondmate home" "$RELINK" "$PRIMARY_HOME"
assert_fails_with "must be an absolute path" "$RELINK" relative/path

printf 'ok - secondmate project relink covers all eight app repos and refuses unprovable clones\n'
