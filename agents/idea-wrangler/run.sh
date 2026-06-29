#!/usr/bin/env bash
# =============================================================================
# Idea Wrangler — workflow runner (the harness entrypoint for this agent).
# =============================================================================
# Invoked by the sandbox in the AGENT phase (SANDBOX_PROFILE=idea-wrangler →
# HARNESS_CMD=/opt/workload/run.sh). The environment is already locked down: no
# write/push creds, egress allowlist active, read-only tokens sourced.
#
# Flow:  validate seed → load standing context → run Claude one-shot (read-only,
#        writes the concept to a file) → emit the file to Linear via email → audit.
#
# The MODEL never sends anything; this script performs the single, deterministic
# emit to one fixed internal address after the model exits.
# =============================================================================
set -uo pipefail

WORKLOAD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_DIR="${SANDBOX_CONTEXT_DIR:-/opt/context}"
SEED="${SANDBOX_INPUT:-/opt/seed/seed.json}"
OUT_DIR="${IDEA_WRANGLER_OUT:-/work/out}"
CONCEPT_OUT="$OUT_DIR/concept.md"
CONFIG="$WORKLOAD_DIR/config.json"

SANDBOX_DIR="${SANDBOX_DIR:-/opt/sandbox}"
_audit() { node "$SANDBOX_DIR/lib/audit.mjs" "$@" 2>/dev/null || true; }
die() { echo "✖ $*" >&2; _audit idea.error "reason=$1"; exit 1; }

mkdir -p "$OUT_DIR"
echo "── Idea Wrangler ─ seed=$SEED out=$CONCEPT_OUT"

# 1. Validate the seed — fail loudly, never guess. -----------------------------
[ -f "$SEED" ] || die "seed_missing (no file at $SEED — provide the /brain-fart seed JSON)"
node -e '
  const fs=require("fs");
  let s; try { s=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); }
  catch(e){ console.error("seed is not valid JSON: "+e.message); process.exit(2); }
  const req=["raw_idea","initial_read","why_mark_wants_it","suspected_problems","must_investigate"];
  const missing=req.filter(k=>!(k in s) || s[k]==null || (typeof s[k]==="string" && !s[k].trim()));
  if(missing.length){ console.error("seed missing required fields: "+missing.join(", ")); process.exit(3); }
' "$SEED" || die "seed_malformed"
echo "  ✓ seed valid"

# 2. Resolve read-only credentials the agent expects. --------------------------
# The sandbox emits LINEAR_TOKEN; the Linear read pattern uses LINEAR_API_KEY.
export LINEAR_API_KEY="${LINEAR_API_KEY:-${LINEAR_TOKEN:-}}"
[ -n "${LINEAR_API_KEY:-}" ] && echo "  ✓ Linear read available" || echo "  ! Linear token absent — agent will note the gap"
[ -n "${SENTRY_TOKEN:-}" ]   && echo "  ✓ Sentry read available"   || echo "  ! Sentry token absent — agent will note the gap"

# 3. Build the standing-context + seed preamble for the model. -----------------
read_ctx() { [ -f "$1" ] && { echo "### $2"; cat "$1"; echo; } || echo "### $2
(missing — note in the concept that this context is incomplete)
"; }
PREAMBLE="$(cat <<EOF
You are running now. Read the STANDING CONTEXT and the SEED below, then execute your
ordered process and WRITE the finished Idea Concept (exact template) to this file:

    $CONCEPT_OUT

Cloned codebase to research is under: ${SANDBOX_WORKDIR:-/work/roe-codebase}
Do NOT send anything. When the file is written, stop.

## STANDING CONTEXT
$(read_ctx "$CONTEXT_DIR/strategy.md"  "Strategy")
$(read_ctx "$CONTEXT_DIR/non-goals.md" "Non-Goals")
$(read_ctx "$CONTEXT_DIR/roadmap.md"   "Roadmap")

## SEED (the triaged brain-fart — raw_idea is verbatim, never paraphrase it)
$(cat "$SEED")
EOF
)"

# 4. Run Claude one-shot, timeboxed. -------------------------------------------
TIMEOUT="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run?.timeout_secs||900)' "$CONFIG" 2>/dev/null || echo 900)"
CLAUDE_FLAGS="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).run?.claude_flags||"--permission-mode bypassPermissions")' "$CONFIG" 2>/dev/null || echo '--permission-mode bypassPermissions')"

if ! command -v claude >/dev/null 2>&1; then die "claude_not_installed"; fi
echo "  → running Claude (timeout ${TIMEOUT}s)…"
_audit idea.run_start "seed=$SEED timeout=$TIMEOUT"

# shellcheck disable=SC2086
timeout "${TIMEOUT}" claude -p "$PREAMBLE" \
  --append-system-prompt "$(cat "$WORKLOAD_DIR/system-prompt.md")" \
  --add-dir "${SANDBOX_WORKDIR:-/work/roe-codebase}" \
  --add-dir "$CONTEXT_DIR" \
  --add-dir "$OUT_DIR" \
  $CLAUDE_FLAGS 2>&1 | sed 's/^/    /'
rc=${PIPESTATUS[0]}
[ "$rc" = "124" ] && echo "  ! Claude hit the timebox (${TIMEOUT}s) — checking for a partial concept"

# 5. Verify a concept was produced. --------------------------------------------
if [ ! -s "$CONCEPT_OUT" ]; then
  die "no_concept_written (Claude exited rc=$rc without writing $CONCEPT_OUT)"
fi
echo "  ✓ concept written ($(wc -l < "$CONCEPT_OUT") lines)"
_audit idea.concept_ready "lines=$(wc -l < "$CONCEPT_OUT")"

# 6. Emit to Linear via email (deterministic, single internal address). --------
if [ "${IDEA_WRANGLER_EMIT:-1}" = "0" ]; then
  echo "  → emit skipped (IDEA_WRANGLER_EMIT=0). Concept at: $CONCEPT_OUT"
  _audit idea.emit_skipped
else
  node "$WORKLOAD_DIR/emit.mjs" --concept "$CONCEPT_OUT" --config "$CONFIG" \
    || die "emit_failed (concept preserved at $CONCEPT_OUT — send it manually)"
fi

echo "✅ Idea Wrangler complete."
