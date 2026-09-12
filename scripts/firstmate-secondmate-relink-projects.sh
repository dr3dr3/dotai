#!/usr/bin/env bash
# Re-point a secondmate home's project clones at the guarded backing clones.
#
# fm-home-seed.sh provisions a secondmate's projects as independent clones inside
# the secondmate home. Those paths sit outside the RoE repository volumes, so the
# Treehouse guard refuses `treehouse get` there and every worker spawn from that
# secondmate dies on fm-spawn.sh's isolated-worktree wait. Worker worktrees also
# have to live on the per-repo volumes to be servable at /app for validation.
#
# This replaces each clone with a symlink to the same target the primary home
# registers, which is the backing-clone arrangement the guard already permits.
# It is idempotent: an entry already linked inside the project root is left alone.
#
# It can also widen a second mate's scope: --add registers a project the primary
# home already carries, and --add-all registers every one the second mate lacks.
# The link, the data/projects.md entry, and the charter's "Project clones" list
# are updated together, because a second mate that cannot see all three as the
# same set will brief crew against projects it has no copy of.
#
# Usage:
#   firstmate-secondmate-relink-projects.sh <secondmate-home> [--dry-run]
#                                           [--primary-home <path>]
#                                           [--backup-dir <path>]
#                                           [--add <project>]... [--add-all]
#
# A clone is only replaced when it can be proven to hold no unique work: clean
# worktree, no stashes, and every local branch tracking an upstream it is not
# ahead of. Anything unprovable refuses, naming the project, rather than moving
# work aside. Replaced clones are moved to the backup directory, never deleted.

set -euo pipefail

PROJECT_ROOT="${ROE_FIRSTMATE_PROJECT_ROOT:-/workspace/repos}"
PRIMARY_HOME="${ROE_FIRSTMATE_PRIMARY_HOME:-/workspace/.firstmate-home}"
SUB_HOME_MARKER=".fm-secondmate-home"
DRY_RUN=0
BACKUP_DIR=""
SECOND_MATE_HOME=""
ADD_ALL=0
ADD_PROJECTS=()

die() {
  printf 'firstmate-secondmate-relink: %s\n' "$1" >&2
  exit 1
}

note() {
  printf '%s\n' "$1"
}

while (( $# )); do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --primary-home)
      shift; [[ $# -gt 0 ]] || die "--primary-home requires a value"; PRIMARY_HOME="$1" ;;
    --primary-home=*) PRIMARY_HOME="${1#*=}" ;;
    --backup-dir)
      shift; [[ $# -gt 0 ]] || die "--backup-dir requires a value"; BACKUP_DIR="$1" ;;
    --backup-dir=*) BACKUP_DIR="${1#*=}" ;;
    --add)
      shift; [[ $# -gt 0 ]] || die "--add requires a project name"; ADD_PROJECTS+=("$1") ;;
    --add=*) ADD_PROJECTS+=("${1#*=}") ;;
    --add-all) ADD_ALL=1 ;;
    -h|--help)
      sed -n '3,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    -*) die "unknown option: $1" ;;
    *)
      [[ -z "$SECOND_MATE_HOME" ]] || die "expected exactly one secondmate home"
      SECOND_MATE_HOME="$1" ;;
  esac
  shift
done

[[ -n "$SECOND_MATE_HOME" ]] || die "usage: firstmate-secondmate-relink-projects.sh <secondmate-home> [--dry-run]"
[[ "$SECOND_MATE_HOME" == /* ]] || die "secondmate home must be an absolute path: $SECOND_MATE_HOME"
[[ -d "$SECOND_MATE_HOME" ]] || die "secondmate home is not a directory: $SECOND_MATE_HOME"

# The marker is what separates a secondmate home from the primary one. Without
# this test a mistyped path could strip the primary home's own registrations.
[[ -f "$SECOND_MATE_HOME/$SUB_HOME_MARKER" ]] \
  || die "not a secondmate home (missing $SUB_HOME_MARKER): $SECOND_MATE_HOME"

[[ -d "$PRIMARY_HOME/projects" ]] || die "primary home has no projects directory: $PRIMARY_HOME/projects"
SECOND_MATE_PROJECTS="$SECOND_MATE_HOME/projects"
[[ -d "$SECOND_MATE_PROJECTS" ]] || die "secondmate home has no projects directory: $SECOND_MATE_PROJECTS"
[[ ! -L "$SECOND_MATE_PROJECTS" ]] || die "secondmate projects directory must not be a symlink: $SECOND_MATE_PROJECTS"

[[ -d "$PROJECT_ROOT" ]] || die "project root is not a directory: $PROJECT_ROOT"
project_root_real="$(cd "$PROJECT_ROOT" && pwd -P)/"

resolved_target() {
  local name="$1" link="$PRIMARY_HOME/projects/$1" target
  [[ -e "$link" ]] || die "project $name is not registered in the primary home: $link"
  target="$(readlink -f "$link")" || die "cannot resolve the primary registration for $name: $link"
  [[ -d "$target" ]] || die "primary registration for $name does not resolve to a directory: $target"
  [[ "$target/" == "$project_root_real"* ]] \
    || die "primary registration for $name resolves off the repository volumes: $target"
  printf '%s\n' "$target"
}

# Refuse anything whose contents cannot be shown to exist elsewhere already.
assert_clone_is_disposable() {
  local name="$1" path="$2" branch upstream ahead

  git -C "$path" rev-parse --git-dir >/dev/null 2>&1 \
    || die "project $name is not a git repository; move it aside yourself: $path"
  [[ -z "$(git -C "$path" status --porcelain 2>/dev/null)" ]] \
    || die "project $name has uncommitted changes; commit or discard them first: $path"
  [[ -z "$(git -C "$path" stash list 2>/dev/null)" ]] \
    || die "project $name has stashed changes; resolve them first: $path"
  git -C "$path" symbolic-ref -q HEAD >/dev/null \
    || die "project $name is on a detached HEAD; cannot prove its commit is pushed: $path"

  while read -r branch; do
    [[ -n "$branch" ]] || continue
    upstream="$(git -C "$path" rev-parse --abbrev-ref --symbolic-full-name "$branch@{u}" 2>/dev/null)" \
      || die "project $name branch $branch has no upstream; cannot prove it is pushed: $path"
    ahead="$(git -C "$path" rev-list --count "$upstream..$branch" 2>/dev/null)" \
      || die "project $name branch $branch cannot be compared with $upstream: $path"
    (( ahead == 0 )) \
      || die "project $name branch $branch has $ahead unpushed commit(s); push them first: $path"
  done < <(git -C "$path" for-each-ref --format='%(refname:short)' refs/heads)
}

CHARTER="$SECOND_MATE_HOME/data/charter.md"

# Mirror the primary home's description so the two registries read the same, and
# fall back to a neutral line when the primary has none.
registry_line_for() {
  local name="$1" line=""
  if [[ -f "$PRIMARY_HOME/data/projects.md" ]]; then
    line="$(grep -m1 -F -- "- $name [" "$PRIMARY_HOME/data/projects.md")" || line=""
  fi
  if [[ -z "$line" ]]; then
    line="- $name [direct-PR] - registered from the primary home on $(date +%Y-%m-%d)"
  fi
  printf '%s\n' "$line"
}

register_in_registry() {
  local name="$1" registry="$SECOND_MATE_HOME/data/projects.md"
  install -d -m 0700 "$SECOND_MATE_HOME/data"
  if [[ -f "$registry" ]] && grep -Fq -- "- $name [" "$registry"; then
    return 0
  fi
  umask 077
  registry_line_for "$name" >>"$registry"
}

# A charter that says the domain has no projects is a contract, not a stale list.
charter_declares_project_less_domain() {
  [[ -f "$CHARTER" ]] || return 1
  awk '
    /^# Project clones/ { inside = 1; next }
    inside && /^#/ { exit }
    inside && /None\. This is a project-less domain/ { found = 1 }
    END { exit(found ? 0 : 1) }
  ' "$CHARTER"
}

# Insert after the section's last bullet, not before the next heading: the blank
# line between them would otherwise separate the new entry from the list.
charter_add_project() {
  local name="$1" tmp
  [[ -f "$CHARTER" ]] || return 0
  if ! grep -q '^# Project clones' "$CHARTER"; then
    return 0
  fi
  if grep -Fxq -- "- $name" "$CHARTER"; then
    return 0
  fi
  tmp="$(mktemp)"
  awk -v entry="- $name" '
    NR == FNR {
      if ($0 ~ /^# Project clones/) { heading = FNR; inside = 1; next }
      if (inside && $0 ~ /^#/) { inside = 0 }
      if (inside && $0 ~ /^- /) { last = FNR }
      next
    }
    { print }
    FNR == (last ? last : heading) { print entry }
  ' "$CHARTER" "$CHARTER" >"$tmp"
  cat "$tmp" >"$CHARTER"
  rm -f "$tmp"
}

backup_dir_for() {
  if [[ -n "$BACKUP_DIR" ]]; then
    printf '%s\n' "$BACKUP_DIR"
    return
  fi
  printf '%s/firstmate-secondmate-relink-%s\n' \
    "${TMPDIR:-/tmp}" "$(date +%Y%m%d%H%M%S)"
}

relinked=0
skipped=0
backup_root=""

shopt -s nullglob
entries=("$SECOND_MATE_PROJECTS"/*)
shopt -u nullglob
(( ${#entries[@]} )) || die "secondmate home has no registered projects: $SECOND_MATE_PROJECTS"

for entry in "${entries[@]}"; do
  name="$(basename "$entry")"

  if [[ -L "$entry" ]]; then
    current="$(readlink -f "$entry")" || die "cannot resolve existing link for $name: $entry"
    [[ "$current/" == "$project_root_real"* ]] \
      || die "project $name is already a link off the repository volumes: $entry -> $current"
    note "$name already linked -> $current"
    (( skipped += 1 ))
    continue
  fi

  [[ -d "$entry" ]] || die "project $name is neither a directory nor a symlink: $entry"

  target="$(resolved_target "$name")"
  assert_clone_is_disposable "$name" "$entry"

  if (( DRY_RUN == 1 )); then
    note "would relink $name -> $target"
    (( relinked += 1 ))
    continue
  fi

  if [[ -z "$backup_root" ]]; then
    backup_root="$(backup_dir_for)"
    mkdir -p "$backup_root"
  fi
  [[ ! -e "$backup_root/$name" ]] || die "backup already holds $name: $backup_root/$name"

  mv "$entry" "$backup_root/$name"
  ln -s "$target" "$entry"
  note "relinked $name -> $target"
  (( relinked += 1 ))
done

if (( ADD_ALL == 1 )); then
  shopt -s nullglob
  for primary_link in "$PRIMARY_HOME"/projects/*; do
    candidate="$(basename "$primary_link")"
    [[ -e "$SECOND_MATE_PROJECTS/$candidate" ]] || ADD_PROJECTS+=("$candidate")
  done
  shopt -u nullglob
fi

added=0
for name in ${ADD_PROJECTS+"${ADD_PROJECTS[@]}"}; do
  if [[ -e "$SECOND_MATE_PROJECTS/$name" ]]; then
    note "$name already registered"
    continue
  fi
  target="$(resolved_target "$name")"
  if charter_declares_project_less_domain; then
    die "charter declares a project-less domain; re-scaffold it before adding $name"
  fi

  if (( DRY_RUN == 1 )); then
    note "would add $name -> $target"
    (( added += 1 ))
    continue
  fi

  ln -s "$target" "$SECOND_MATE_PROJECTS/$name"
  register_in_registry "$name"
  charter_add_project "$name"
  note "added $name -> $target"
  (( added += 1 ))
done

if (( DRY_RUN == 1 )); then
  printf 'dry run: %s to relink, %s already linked, %s to add\n' "$relinked" "$skipped" "$added"
  exit 0
fi

printf 'relinked %s, already linked %s, added %s\n' "$relinked" "$skipped" "$added"
[[ -z "$backup_root" ]] || printf 'replaced clones moved to %s\n' "$backup_root"
