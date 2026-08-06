#!/usr/bin/env bash
# =============================================================================
# wip.sh — work-in-progress session tracker
# -----------------------------------------------------------------------------
# A per-session index that sits ON TOP of your PRs. It stores only the durable
# session<->work mapping (which conversation/window, your intent) and refreshes
# everything derivable (PR state, CI, deploy) live from `gh` + build-info.txt.
#
# Storage: one JSON file per session under $WIP_DIR (default /workspace/.wip),
#          so concurrent Claude/Copilot sessions never clobber each other.
#
# Subcommands:
#   register   create/update THIS session's base record (auto-captures session)
#   add-pr     attach a PR to a session
#   set        update state / nextAction / notes / name
#   depends    mark a session blocked on another (slug / repo#num / free text)
#   refresh    re-pull live PR + deploy status for one or all sessions
#   list       emit the enriched, priority-sorted JSON array (for tooling)
#   view       refresh all + render the human cockpit (the everyday command)
#   render     render the cockpit without refreshing (offline-safe)
#   handoff    continue a WIP in a FRESH session: brief + take ownership
#              (aliases: resume, continue) — old session kept in .priorSessions
#   archive    retire a finished session to $WIP_DIR/archive
#   rm         delete a session record
#   path       print the file path for a slug
#   whoami     print THIS session's slug (matched by resume id), if tracked
#
# Everything degrades gracefully: no gh auth / no network -> last-known snapshot.
# =============================================================================
set -uo pipefail

WIP_DIR="${WIP_DIR:-/workspace/.wip}"
GH_ORG="${WIP_GH_ORG:-rock-of-eye}"
mkdir -p "$WIP_DIR/archive"

_now()      { date -u +%Y-%m-%dT%H:%M:%SZ; }
_die()      { echo "wip: $*" >&2; exit 1; }
_slugify()  { echo "$1" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+|-+$//g'; }
_file()     { echo "$WIP_DIR/$1.json"; }

# ---- the slug of THIS session's record (matched by stable resume id) ---------
_current_slug() {
  local rid="${CLAUDE_CODE_SESSION_ID:-}" f
  [[ -z "$rid" ]] && return 0
  for f in "$WIP_DIR"/*.json; do
    [[ -e "$f" ]] || continue
    [[ "$(jq -r '.session.resumeId // ""' "$f")" == "$rid" ]] && { jq -r '.slug' "$f"; return 0; }
  done
}

# ---- on-disk Claude Code transcript for a session id (empty if not found) -----
_transcript_path() {
  local id="${1:-}"; [[ -z "$id" ]] && return 0
  find "$HOME/.claude/projects" -maxdepth 2 -name "$id.jsonl" 2>/dev/null | head -1
}

# ---- staging build-info host map (portals have no stamp -> unknown) ----------
_deploy_host() {
  case "$1" in
    rock-of-eye-api)      echo api ;;
    rock-of-eye-sso)      echo sso ;;
    rock-of-eye-pms-core) echo pms-core ;;
    *) echo "" ;;
  esac
}

# ---- capture the current session's identity ---------------------------------
_capture_session() {
  local harness resume cwd branch toplevel worktree gitdir commondir in_worktree reliable
  resume="${CLAUDE_CODE_SESSION_ID:-}"
  case "${AI_AGENT:-}" in
    claude-code*) harness="claude-code" ;;
    "")           harness="unknown" ;;
    *)            harness="${AI_AGENT%%_*}" ;;
  esac
  cwd="$PWD"
  branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  toplevel="$(git rev-parse --show-toplevel 2>/dev/null || true)"
  gitdir="$(git rev-parse --absolute-git-dir 2>/dev/null || true)"
  commondir="$(git rev-parse --git-common-dir 2>/dev/null || true)"
  [[ -n "$commondir" && "$commondir" != /* ]] && commondir="$(cd "$commondir" 2>/dev/null && pwd || echo "$commondir")"
  # Worktree vs shared main checkout. A linked worktree has its own git-dir
  # (…/.git/worktrees/<name>) distinct from the common dir; RoE also always nests
  # worktrees under …/.worktrees/. Either signal ⇒ worktree.
  in_worktree=false
  if [[ "$toplevel" == *"/.worktrees/"* ]] \
     || { [[ -n "$gitdir" && -n "$commondir" && "$gitdir" != "$commondir" ]]; }; then
    in_worktree=true
  fi
  worktree="null"
  [[ "$in_worktree" == true && -n "$toplevel" ]] && worktree="$(jq -Rn --arg p "$toplevel" '$p')"
  # Branch reliability. A worktree is pinned to its own branch → the captured
  # HEAD is genuinely this session's. A SHARED checkout (/workspace,
  # /workspace/repos/*) is moved between branches by any parallel session, so its
  # HEAD is last-writer-wins, NOT ours — mark it unreliable so nothing trusts it.
  reliable=$([[ "$in_worktree" == true ]] && echo true || echo false)
  jq -n \
    --arg harness "$harness" --arg resume "$resume" --arg cwd "$cwd" \
    --arg branch "$branch" --argjson worktree "$worktree" --argjson reliable "$reliable" \
    '{harness:$harness, resumeId:$resume, cwd:$cwd, branch:$branch,
      branchReliable:$reliable, worktreePath:$worktree}'
}

# ---- write JSON atomically ---------------------------------------------------
_atomic_write() { # $1=file  (reads new content on stdin)
  local f="$1" tmp; tmp="$(mktemp)"
  cat > "$tmp" && mv "$tmp" "$f"
}

# =============================================================================
cmd_register() {
  local slug="" name="" linear="" state="in-progress" next="" branch_override=""
  while [[ $# -gt 0 ]]; do case "$1" in
    --slug)    slug="$2"; shift 2 ;;
    --name)    name="$2"; shift 2 ;;
    --linear)  linear="$2"; shift 2 ;;
    --state)   state="$2"; shift 2 ;;
    --next)    next="$2"; shift 2 ;;
    --branch)  branch_override="$2"; shift 2 ;;
    *) _die "register: unknown arg $1" ;;
  esac; done

  local session; session="$(_capture_session)"
  # an explicitly-supplied branch (the session knows what it actually worked on,
  # even if merged-and-gone) overrides the unreliable shared-checkout HEAD.
  if [[ -n "$branch_override" ]]; then
    session="$(jq -c --arg b "$branch_override" '.branch=$b | .branchReliable=true' <<<"$session")"
  fi
  local branch reliable
  branch="$(jq -r '.branch' <<<"$session")"
  reliable="$(jq -r '.branchReliable' <<<"$session")"
  # slug resolution when --slug omitted:
  #  1. this session is ALREADY tracked (match by resume id) → update in place,
  #     even if it was registered under a custom slug. Prevents duplicates.
  #  2. otherwise derive: linear id, else branch, else session id.
  if [[ -z "$slug" ]]; then
    slug="$(_current_slug)"
    if [[ -z "$slug" ]]; then
      if   [[ -n "$linear" ]]; then slug="$(_slugify "$linear")"
      # only derive a slug from the branch when it's RELIABLE (worktree or
      # explicit --branch). A shared-checkout HEAD may be another session's.
      elif [[ "$reliable" == true && -n "$branch" && "$branch" != "HEAD" ]]; then slug="$(_slugify "$branch")"
      else slug="$(_slugify "${CLAUDE_CODE_SESSION_ID:-session}" | cut -c1-12)"; fi
    fi
  fi
  [[ -z "$name" ]] && name="$slug"

  local f; f="$(_file "$slug")"
  local now; now="$(_now)"
  if [[ -f "$f" ]]; then
    # merge: keep prs/createdAt, refresh session + provided fields
    jq \
      --arg name "$name" --arg linear "$linear" --arg state "$state" \
      --arg next "$next" --argjson session "$session" --arg now "$now" \
      '.name = (if $name=="" then .name else $name end)
       | .linear = (if $linear=="" then .linear else $linear end)
       | .state = $state
       | .nextAction = (if $next=="" then .nextAction else $next end)
       | .session = $session
       | .updatedAt = $now' "$f" | _atomic_write "$f"
  else
    jq -n \
      --arg slug "$slug" --arg name "$name" --arg linear "$linear" \
      --arg state "$state" --arg next "$next" --argjson session "$session" \
      --arg now "$now" \
      '{slug:$slug, name:$name, linear:$linear, state:$state,
        session:$session, prs:[], dependsOn:[], nextAction:$next, notes:"",
        createdAt:$now, updatedAt:$now}' | _atomic_write "$f"
  fi
  echo "$slug"
}

cmd_add_pr() {
  local slug="" repo="" number="" target="staging"
  while [[ $# -gt 0 ]]; do case "$1" in
    --slug)   slug="$2"; shift 2 ;;
    --repo)   repo="$2"; shift 2 ;;
    --number) number="$2"; shift 2 ;;
    --target) target="$2"; shift 2 ;;
    *) _die "add-pr: unknown arg $1" ;;
  esac; done
  [[ -z "$slug" || -z "$repo" || -z "$number" ]] && _die "add-pr needs --slug --repo --number"
  local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug' (register first)"
  local url="https://github.com/$GH_ORG/$repo/pull/$number"
  jq \
    --arg repo "$repo" --argjson number "$number" --arg target "$target" \
    --arg url "$url" --arg now "$(_now)" \
    '(.prs |= (map(select(.repo==$repo and .number==$number)) | length) as $n
        | if $n>0 then map(if .repo==$repo and .number==$number then .deploy.target=$target else . end)
          else . + [{repo:$repo, number:$number, url:$url, targetBranch:$target,
                     deploy:{target:$target, status:"unknown"},
                     lastKnown:{state:"OPEN", draft:true, mergeable:"UNKNOWN", review:"", ci:"none"}}] end)
     | .updatedAt=$now' "$f" | _atomic_write "$f"
  echo "attached $repo#$number -> $slug"
}

cmd_set() {
  local slug="" state="" next="" notes="" name="" branch=""
  while [[ $# -gt 0 ]]; do case "$1" in
    --slug)   slug="$2"; shift 2 ;;
    --state)  state="$2"; shift 2 ;;
    --next)   next="$2"; shift 2 ;;
    --notes)  notes="$2"; shift 2 ;;
    --name)   name="$2"; shift 2 ;;
    --branch) branch="$2"; shift 2 ;;
    *) _die "set: unknown arg $1" ;;
  esac; done
  local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug'"
  jq --arg state "$state" --arg next "$next" --arg notes "$notes" --arg name "$name" --arg branch "$branch" --arg now "$(_now)" \
    '(if $state!="" then .state=$state else . end)
     | (if $next!=""  then .nextAction=$next else . end)
     | (if $notes!="" then .notes=$notes else . end)
     | (if $name!=""  then .name=$name else . end)
     | (if $branch!="" then (.session.branch=$branch | .session.branchReliable=true) else . end)
     | .updatedAt=$now' "$f" | _atomic_write "$f"
  echo "updated $slug"
}

cmd_depends() {
  local slug="" on="" note="" remove="" clear=0
  while [[ $# -gt 0 ]]; do case "$1" in
    --slug)   slug="$2"; shift 2 ;;
    --on)     on="$2"; shift 2 ;;
    --note)   note="$2"; shift 2 ;;
    --remove) remove="$2"; shift 2 ;;
    --clear)  clear=1; shift ;;
    *) _die "depends: unknown arg $1" ;;
  esac; done
  local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug'"
  if [[ "$clear" == 1 ]]; then
    jq --arg now "$(_now)" '.dependsOn=[] | .updatedAt=$now' "$f" | _atomic_write "$f"
    echo "cleared deps on $slug"; return
  fi
  if [[ -n "$remove" ]]; then
    jq --arg r "$remove" --arg now "$(_now)" \
      '.dependsOn = ((.dependsOn // []) | map(select(.on != $r))) | .updatedAt=$now' "$f" | _atomic_write "$f"
    echo "removed dep '$remove' from $slug"; return
  fi
  [[ -z "$on" ]] && _die "depends needs --on <slug|repo#num|text> (or --remove/--clear)"
  jq --arg on "$on" --arg note "$note" --arg now "$(_now)" \
    '.dependsOn = ((.dependsOn // []) | map(select(.on != $on)) + [{on:$on, note:$note}])
     | .updatedAt=$now' "$f" | _atomic_write "$f"
  echo "blocked $slug on $on"
}

# ---- resolve a dependency ref to a display string (+ owning session's resume) -
_resolve_dep() { # $1=ref  -> human string
  local ref="$1" sf nm rid num f hit
  sf="$WIP_DIR/$ref.json"
  if [[ -f "$sf" ]]; then                       # 1. exact slug match
    nm="$(jq -r '.name' "$sf")"; rid="$(jq -r '.session.resumeId // ""' "$sf")"
    [[ -n "$rid" ]] && echo "$nm  ·  claude --resume $rid" || echo "$nm"
    return
  fi
  num="${ref##*#}"                              # 2. PR number match (repo#num / #num / num)
  if [[ "$num" =~ ^[0-9]+$ ]]; then
    for f in "$WIP_DIR"/*.json; do
      [[ -e "$f" ]] || continue
      hit="$(jq -r --argjson n "$num" 'if any(.prs[]?; .number==$n) then "y" else "" end' "$f")"
      if [[ "$hit" == "y" ]]; then
        nm="$(jq -r '.name' "$f")"; rid="$(jq -r '.session.resumeId // ""' "$f")"
        [[ -n "$rid" ]] && echo "$ref — owned by $nm  ·  claude --resume $rid" || echo "$ref — owned by $nm"
        return
      fi
    done
    echo "$ref (no tracked session owns it yet)"; return
  fi
  echo "$ref"                                   # 3. free text
}

# ---- live deploy check (best-effort, staging only) --------------------------
_check_deploy() { # $1=repo $2=target $3=sha  -> deployed|not-deployed|unknown
  local repo="$1" target="$2" sha="$3" host bi deployed
  [[ -z "$sha" || "$target" != "staging" ]] && { echo unknown; return; }
  host="$(_deploy_host "$repo")"; [[ -z "$host" ]] && { echo unknown; return; }
  bi="$(curl -fsS --max-time 6 "https://${host}.roe-staging.com/build-info.txt" 2>/dev/null || true)"
  [[ -z "$bi" ]] && { echo unknown; return; }
  deployed="$(printf '%s\n' "$bi" | grep -oiE '[0-9a-f]{7,40}' | head -1)"
  [[ -z "$deployed" ]] && { echo unknown; return; }
  if [[ "${sha:0:7}" == "${deployed:0:7}" ]]; then echo deployed; else echo not-deployed; fi
}

_refresh_file() {
  local f="$1" n i pr repo number target gh_json prs_new="[]"
  n="$(jq '.prs | length' "$f")"
  for ((i=0; i<n; i++)); do
    pr="$(jq -c ".prs[$i]" "$f")"
    repo="$(jq -r '.repo' <<<"$pr")"
    number="$(jq -r '.number' <<<"$pr")"
    target="$(jq -r '.deploy.target // "staging"' <<<"$pr")"
    gh_json="$(gh pr view "$number" --repo "$GH_ORG/$repo" \
      --json state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergeCommit,url 2>/dev/null || true)"
    if [[ -n "$gh_json" ]]; then
      local state draft mergeable review sha url ci ds
      state="$(jq -r '.state' <<<"$gh_json")"
      draft="$(jq -r '.isDraft' <<<"$gh_json")"
      mergeable="$(jq -r '.mergeable' <<<"$gh_json")"
      review="$(jq -r '.reviewDecision // ""' <<<"$gh_json")"
      sha="$(jq -r '.mergeCommit.oid // ""' <<<"$gh_json")"
      url="$(jq -r '.url' <<<"$gh_json")"
      ci="$(jq -r '
        (.statusCheckRollup // []) as $c
        | if ($c|length)==0 then "none"
          elif any($c[]; .conclusion=="FAILURE" or .conclusion=="CANCELLED" or .conclusion=="TIMED_OUT" or .state=="FAILURE" or .state=="ERROR") then "failing"
          elif any($c[]; (.status!=null and .status!="COMPLETED") or .state=="PENDING" or .state=="EXPECTED") then "pending"
          else "passing" end' <<<"$gh_json")"
      ds="unknown"
      [[ "$state" == "MERGED" ]] && ds="$(_check_deploy "$repo" "$target" "$sha")"
      pr="$(jq -c \
        --arg state "$state" --argjson draft "$draft" --arg mergeable "$mergeable" \
        --arg review "$review" --arg ci "$ci" --arg url "$url" --arg ds "$ds" \
        '.url=$url
         | .lastKnown={state:$state, draft:$draft, mergeable:$mergeable, review:$review, ci:$ci}
         | .deploy.status=$ds' <<<"$pr")"
    fi
    prs_new="$(jq -c --argjson pr "$pr" '. + [$pr]' <<<"$prs_new")"
  done
  jq --argjson prs "$prs_new" --arg now "$(_now)" '.prs=$prs | .updatedAt=$now' "$f" | _atomic_write "$f"
}

cmd_refresh() {
  local slug="${1:-}"
  if [[ -n "$slug" && "$slug" != "--all" ]]; then
    local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug'"
    _refresh_file "$f"; echo "refreshed $slug"; return
  fi
  local any=0
  for f in "$WIP_DIR"/*.json; do [[ -e "$f" ]] || continue; any=1; _refresh_file "$f"; done
  [[ "$any" == 1 ]] && echo "refreshed all" || echo "nothing to refresh"
}

# ---- ranking (lower = more urgent) ------------------------------------------
_JQ_RANK='
def rank:
  (.prs // []) as $p
  # explicit human state wins first — a workstream marked done/verified
  # sinks regardless of PR-derived status.
  | if   .state=="done" then 7
    elif .state=="verified" then 6
    elif ($p|length)==0 then 5
    elif any($p[]; .lastKnown.ci=="failing") then 0
    elif any($p[]; .lastKnown.state=="OPEN" and (.lastKnown.draft|not)
              and .lastKnown.review=="APPROVED" and .lastKnown.mergeable=="MERGEABLE") then 1
    # 🚢 only when a merged PR is *genuinely* behind its staging deploy. Repos
    # outside the deploy host-map (local-dev-env, portals) report deploy=unknown
    # — that is n/a, not "awaiting deploy", so it must NOT trip rank 2.
    elif any($p[]; .lastKnown.state=="MERGED" and .deploy.status=="not-deployed") then 2
    elif any($p[]; .lastKnown.state=="OPEN" and (.lastKnown.draft|not)) then 3
    elif any($p[]; .lastKnown.draft==true) then 4
    # all PRs merged (deploy verified or n/a) → ready to verify & archive.
    elif all($p[]; .lastKnown.state=="MERGED") then 6
    else 5 end;
def emoji: {"0":"❌","1":"✅","2":"🚢","3":"⏳","4":"📝","5":"🌱","6":"🚀","7":"✔️"}[(.|tostring)];
'

cmd_list() {  # enriched, sorted JSON array
  shopt -s nullglob
  local files=("$WIP_DIR"/*.json)
  [[ ${#files[@]} -eq 0 ]] && { echo "[]"; return; }
  jq -s "$_JQ_RANK"'map(. + {rank: rank}) | map(. + {emoji: (.rank|emoji)}) | sort_by(.rank, .updatedAt)' "${files[@]}"
}

cmd_render() {
  local data; data="$(cmd_list)"
  local count; count="$(jq 'length' <<<"$data")"
  if [[ "$count" -eq 0 ]]; then
    echo "WIP — no active sessions. Run: wip register --name \"...\" --linear ENG-000"
    return
  fi
  echo "WIP — $count active session(s)   ·   $(date -u '+%Y-%m-%d %H:%M UTC')"
  echo
  local i
  for ((i=0; i<count; i++)); do
    local row; row="$(jq -c ".[$i]" <<<"$data")"
    local slug name state rank resume cwd branch breliable worktree next
    slug="$(jq -r '.slug' <<<"$row")"
    name="$(jq -r '.name' <<<"$row")"
    state="$(jq -r '.state' <<<"$row")"
    rank="$(jq -r '.rank' <<<"$row")"
    resume="$(jq -r '.session.resumeId // ""' <<<"$row")"
    cwd="$(jq -r '.session.cwd // ""' <<<"$row")"
    branch="$(jq -r '.session.branch // ""' <<<"$row")"
    breliable="$(jq -r '.session.branchReliable // false' <<<"$row")"
    worktree="$(jq -r '.session.worktreePath // ""' <<<"$row")"
    next="$(jq -r '.nextAction // ""' <<<"$row")"
    # only surface a branch we can trust; a shared-checkout HEAD is not ours.
    local shownbranch=""; [[ "$breliable" == true && -n "$branch" && "$branch" != "HEAD" ]] && shownbranch="$branch"
    local emoji headline
    emoji="$(jq -r '.emoji' <<<"$row")"
    case "$rank" in
      0) headline="CI FAILING" ;;
      1) headline="APPROVED & mergeable — ready to land" ;;
      2) headline="MERGED, not yet on staging" ;;
      3) headline="awaiting review" ;;
      4) headline="draft" ;;
      5) headline="in progress${shownbranch:+ ($shownbranch)}" ;;
      6) headline="merged — verify & archive" ;;
      7) headline="done" ;;
    esac
    printf '%s  %s  —  %s\n' "$emoji" "$name" "$headline"
    # PR lines
    local pn j; pn="$(jq '.prs | length' <<<"$row")"
    for ((j=0; j<pn; j++)); do
      local pr; pr="$(jq -c ".prs[$j]" <<<"$row")"
      local prrepo prnum prstate prdraft prreview prci prds
      prrepo="$(jq -r '.repo' <<<"$pr" | sed 's/^rock-of-eye-//')"
      prnum="$(jq -r '.number' <<<"$pr")"
      prstate="$(jq -r '.lastKnown.state // "?"' <<<"$pr" | tr '[:upper:]' '[:lower:]')"
      prdraft="$(jq -r 'if .lastKnown.draft then " draft" else "" end' <<<"$pr")"
      prreview="$(jq -r 'if .lastKnown.review=="APPROVED" then " ✓approved" elif .lastKnown.review=="CHANGES_REQUESTED" then " ✗changes" else "" end' <<<"$pr")"
      prci="$(jq -r 'if .lastKnown.ci=="failing" then " CI✗" elif .lastKnown.ci=="pending" then " CI…" elif .lastKnown.ci=="passing" then " CI✓" else "" end' <<<"$pr")"
      prds="$(jq -r '.deploy.target + ":" + .deploy.status' <<<"$pr")"
      printf '   %s#%s (%s%s%s%s) · %s\n' "$prrepo" "$prnum" "$prstate" "$prdraft" "$prreview" "$prci" "$prds"
    done
    # blocked-on lines
    local dn k; dn="$(jq '(.dependsOn // []) | length' <<<"$row")"
    for ((k=0; k<dn; k++)); do
      local don dnote disp
      don="$(jq -r ".dependsOn[$k].on" <<<"$row")"
      dnote="$(jq -r ".dependsOn[$k].note // \"\"" <<<"$row")"
      disp="$(_resolve_dep "$don")"
      if [[ -n "$dnote" ]]; then printf '   ⛔ blocked on %s  (%s)\n' "$disp" "$dnote"
      else printf '   ⛔ blocked on %s\n' "$disp"; fi
    done
    [[ -n "$next" ]] && printf '   ▶ %s\n' "$next"
    # return path
    local ret="   ↳"
    [[ -n "$resume" ]] && ret+=" claude --resume $resume"
    if [[ -n "$worktree" && "$worktree" != "null" ]]; then ret+="   · worktree: $worktree"
    elif [[ -n "$cwd" ]]; then ret+="   · $cwd${shownbranch:+ @ $shownbranch}"; fi
    echo "$ret"
    echo
  done
  echo "state: ❌fix CI  ✅land  🚢deploy  ⏳review  📝draft  🌱wip  🚀verify  ✔️done"
}

cmd_view()    { cmd_refresh --all >/dev/null 2>&1 || true; cmd_render; }
cmd_archive() {
  local slug="${1:-}"; [[ -z "$slug" ]] && _die "archive needs a slug"
  local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug'"
  mv "$f" "$WIP_DIR/archive/$slug.json"; echo "archived $slug"
}
cmd_rm()      { local slug="${1:-}"; [[ -z "$slug" ]] && _die "rm needs a slug"; rm -f "$(_file "$slug")"; echo "removed $slug"; }
cmd_path()    { _file "${1:-}"; }

# ---- continue a WIP in a FRESH session: brief + take ownership ----------------
cmd_handoff() {
  local slug="${1:-}"; [[ -z "$slug" ]] && _die "handoff needs a slug (see: wip.sh list)"
  local f; f="$(_file "$slug")"; [[ -f "$f" ]] || _die "no session '$slug' (try: wip.sh list)"
  _refresh_file "$f" >/dev/null 2>&1 || true          # live PR/deploy before briefing
  local rec; rec="$(cat "$f")"
  local name linear state next notes cwd branch breliable worktree oldrid
  name="$(jq -r '.name' <<<"$rec")";        linear="$(jq -r '.linear // ""' <<<"$rec")"
  state="$(jq -r '.state' <<<"$rec")";      next="$(jq -r '.nextAction // ""' <<<"$rec")"
  notes="$(jq -r '.notes // ""' <<<"$rec")"; cwd="$(jq -r '.session.cwd // ""' <<<"$rec")"
  branch="$(jq -r '.session.branch // ""' <<<"$rec")"
  breliable="$(jq -r '.session.branchReliable // false' <<<"$rec")"
  worktree="$(jq -r '.session.worktreePath // ""' <<<"$rec")"
  oldrid="$(jq -r '.session.resumeId // ""' <<<"$rec")"

  echo "═══ WIP handoff: $name  ($slug) ═══"
  [[ -n "$linear" && "$linear" != "null" ]] && echo "Linear:   $linear"
  echo "State:    $state"
  local pn; pn="$(jq '.prs | length' <<<"$rec")"
  if [[ "$pn" -gt 0 ]]; then
    echo "PRs:"
    jq -r '.prs[] | "  \(.repo)#\(.number)  \((.lastKnown.state // "?")|ascii_downcase)" +
           (if .lastKnown.draft then " draft" else "" end) +
           (if .lastKnown.review=="APPROVED" then " ✓approved" elif .lastKnown.review=="CHANGES_REQUESTED" then " ✗changes" else "" end) +
           (if .lastKnown.ci=="failing" then " CI✗" elif .lastKnown.ci=="passing" then " CI✓" elif .lastKnown.ci=="pending" then " CI…" else "" end) +
           "  " + (.deploy.target + ":" + .deploy.status) + "  " + (.url // "")' <<<"$rec"
  fi
  local dn k; dn="$(jq '(.dependsOn // []) | length' <<<"$rec")"
  for ((k=0; k<dn; k++)); do
    local don dnote; don="$(jq -r ".dependsOn[$k].on" <<<"$rec")"; dnote="$(jq -r ".dependsOn[$k].note // \"\"" <<<"$rec")"
    echo "Blocked:  $(_resolve_dep "$don")${dnote:+  ($dnote)}"
  done
  [[ -n "$notes" ]] && echo "Notes:    $notes"
  echo "▶ Next:   ${next:-<none recorded — read the transcript for context>}"
  if [[ -n "$worktree" && "$worktree" != "null" ]]; then
    echo "Work in:  $worktree"
    echo "          (worktree — stage it to run/test: make stage-worktree REPO=<repo> BRANCH=<branch>)"
  elif [[ "$breliable" == true && -n "$branch" && "$branch" != "HEAD" ]]; then
    echo "Work in:  $cwd   (branch: $branch)"
  else
    echo "Work in:  $cwd"
    [[ -n "$branch" && "$branch" != "HEAD" ]] && echo "          (recorded branch '$branch' came from a SHARED checkout — verify, don't trust it)"
  fi
  local tp; tp="$(_transcript_path "$oldrid")"
  [[ -n "$tp" ]] && echo "History:  $tp" && echo "          (prior session's full transcript — read on demand for deep context)"

  # take ownership: point the record at THIS session; keep the old one in history.
  # deliberately PRESERVE cwd/branch/worktree (that's WHERE the work lives — not
  # where this fresh session happens to have started).
  local session newrid newharness
  session="$(_capture_session)"; newrid="$(jq -r '.resumeId' <<<"$session")"; newharness="$(jq -r '.harness' <<<"$session")"
  jq --arg old "$oldrid" --arg new "$newrid" --arg h "$newharness" --arg now "$(_now)" \
    '.priorSessions = (((.priorSessions // []) + (if ($old|length)>0 and $old != $new then [$old] else [] end)) | unique)
     | .session.resumeId = $new
     | .session.harness = $h
     | .updatedAt = $now' "$f" | _atomic_write "$f"
  echo "─────"
  echo "Ownership moved to this session. \"update my WIP\" now targets ‹$slug› here; old session kept in history."
}

case "${1:-view}" in
  register) shift; cmd_register "$@" ;;
  add-pr)   shift; cmd_add_pr "$@" ;;
  set)      shift; cmd_set "$@" ;;
  depends)  shift; cmd_depends "$@" ;;
  refresh)  shift; cmd_refresh "$@" ;;
  list)     shift; cmd_list "$@" ;;
  view)     shift; cmd_view "$@" ;;
  render)   shift; cmd_render "$@" ;;
  handoff|resume|continue) shift; cmd_handoff "$@" ;;
  archive)  shift; cmd_archive "$@" ;;
  rm)       shift; cmd_rm "$@" ;;
  path)     shift; cmd_path "$@" ;;
  whoami)   shift; _current_slug || true ;;
  help|-h|--help) grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' ;;
  *) _die "unknown command '${1}' (try: view register add-pr set refresh archive)" ;;
esac
