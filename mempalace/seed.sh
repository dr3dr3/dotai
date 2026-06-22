#!/usr/bin/env bash
# =============================================================================
# mempalace — seed the palace (André's trial)  ·  DOCS + SESSIONS scope
# =============================================================================
# Division of labour (see README): Graphify owns codebase STRUCTURE; MemPalace
# owns MEMORY — AI sessions + prose/decisions Graphify can't represent. So we do
# NOT mine raw source here. We mine:
#   • past Claude Code conversations  (~/.claude/projects)
#   • ai-context  (the main documentation repo — markdown, not a docs/ folder)
#   • EVERY `docs/` folder anywhere under /workspace (auto-discovered)
#
# Dedup: a `docs/` dir inside a git worktree of a repo already covered (e.g.
# tenants-views-wt → rock-of-eye-api) is skipped via git-origin matching, so the
# same docs aren't filed twice. `mine` respects .gitignore by default.
#
#   bash /workspace/.ai/dotai/mempalace/seed.sh
# =============================================================================
set -uo pipefail

CONVOS_DIR="$HOME/.claude/projects"
WS=/workspace

echo "→ Seeding MemPalace (docs + sessions)"

# 1. Past Claude Code conversations -------------------------------------------
if [ -d "$CONVOS_DIR" ]; then
    echo; echo "=== conversations: $CONVOS_DIR ==="
    mempalace mine "$CONVOS_DIR" --mode convos --wing claude-sessions
fi

# 2. Build a de-duplicated list of doc roots ----------------------------------
declare -A SEEN_PATH      # realpath  -> wing  (avoid mining the same dir twice)
declare -A SEEN_ORIGIN    # repo-name -> 1     (avoid worktree duplicates)

# origin repo short-name for a dir, or "" if not in a git repo / no origin
origin_of() {
    git -C "$1" config --get remote.origin.url 2>/dev/null | sed 's#.*[/:]##; s#\.git$##'
}

add_root() {  # $1=dir  $2=wing
    local dir="$1" wing="$2" rp origin
    rp="$(realpath "$dir" 2>/dev/null)" || return 0
    [ -d "$rp" ] || return 0
    [ -z "$(ls -A "$rp" 2>/dev/null)" ] && return 0          # skip empty
    [ -n "${SEEN_PATH[$rp]:-}" ] && return 0                 # already added
    origin="$(origin_of "$rp")"
    if [ -n "$origin" ] && [ -n "${SEEN_ORIGIN[$origin]:-}" ]; then
        echo "  • skip $rp (worktree dup of '$origin')"; return 0
    fi
    SEEN_PATH[$rp]="$wing"
    [ -n "$origin" ] && SEEN_ORIGIN[$origin]=1
}

# High-value explicit roots first (so canonical clones win the dedup) ----------
add_root "$WS/ai-context" "ai-context"          # main documentation repo (whole)
add_root "$WS/docs"       "local-dev-env-docs"  # local-dev-env guides

# Canonical repo docs next (so their worktrees get deduped afterwards) ---------
for d in "$WS"/repos/*/docs; do
    [ -d "$d" ] && add_root "$d" "$(basename "$(dirname "$d")")-docs"
done

# Infrastructure docs — STABLE wing name regardless of source ------------------
# The canonical /workspace/infrastructure mount is often empty in local-dev-env
# (the volume is owned/populated by the infra devcontainer); the live working
# tree is usually an orphaned git worktree like /workspace/infra-<id>-wt. Prefer
# the canonical mount when populated, else the first infra worktree — but always
# label the wing `infrastructure-docs` so it doesn't depend on a throwaway id.
INFRA_DOCS=""
if [ -n "$(ls -A "$WS/infrastructure/docs" 2>/dev/null)" ]; then
    INFRA_DOCS="$WS/infrastructure/docs"
else
    for d in "$WS"/infra*-wt/docs "$WS"/infra*/docs; do
        [ -d "$d" ] && [ -n "$(ls -A "$d" 2>/dev/null)" ] && { INFRA_DOCS="$d"; break; }
    done
fi
[ -n "$INFRA_DOCS" ] && add_root "$INFRA_DOCS" "infrastructure-docs"

# Generalization: ANY other docs/ folder anywhere under /workspace -------------
# (infra worktrees are handled above, so skip them here to avoid an id-named dup)
while IFS= read -r d; do
    case "$d" in */infra*-wt/docs|"$WS"/infrastructure/docs) continue ;; esac
    add_root "$d" "$(basename "$(dirname "$d")")-docs"
done < <(find "$WS" -type d -name docs \
            -not -path '*/vendor/*'  -not -path '*/node_modules/*' \
            -not -path '*/.git/*'    -not -path '*/dist/*' \
            -not -path '*/build/*'   -not -path '*/.worktrees/*' \
            2>/dev/null | sort)

# 3. Mine each resolved doc root ----------------------------------------------
for rp in "${!SEEN_PATH[@]}"; do
    echo; echo "=== docs: ${SEEN_PATH[$rp]}  ($rp) ==="
    mempalace mine "$rp" --wing "${SEEN_PATH[$rp]}"
done

echo; echo "✅ Seeding complete."
mempalace status
