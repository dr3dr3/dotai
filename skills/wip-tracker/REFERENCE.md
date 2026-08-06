# WIP Tracker — Reference

## Data model (one file per session: `/workspace/.wip/<slug>.json`)

```jsonc
{
  "slug": "eng-2129-compact-labour-form",   // stable key; derived from Linear id, else branch
  "name": "Compact labour form",            // human label shown in the cockpit
  "linear": "ENG-2129",                     // Linear identifier (optional)
  "state": "awaiting-review",               // workstream-level, hand-set — see states below
  "session": {                              // auto-captured at register time
    "harness": "claude-code",               // from $AI_AGENT
    "resumeId": "0a1f9de7-…",               // $CLAUDE_CODE_SESSION_ID → `claude --resume <id>`
    "cwd": "/workspace/repos/rock-of-eye-api",
    "branch": "feat/eng-2129-compact-labour-form",
    "branchReliable": true,                 // true = worktree or explicit --branch; false = shared-checkout HEAD (hidden in cockpit)
    "worktreePath": null                    // set when the session sits in a repos/*/.worktrees/ checkout
  },
  "prs": [
    {
      "repo": "rock-of-eye-api",
      "number": 976,
      "url": "https://github.com/rock-of-eye/rock-of-eye-api/pull/976",
      "targetBranch": "staging",
      "deploy":    { "target": "staging", "status": "unknown" },   // deployed | not-deployed | unknown
      "lastKnown": { "state": "OPEN", "draft": false, "mergeable": "MERGEABLE",
                     "review": "APPROVED", "ci": "passing" }         // refreshed live each `view`
    }
  ],
  "dependsOn": [                            // cross-session blockers (annotation, not a rank change)
    { "on": "rock-of-eye-api#185", "note": "warm-cache AMI bake" }
    // .on may be: another session's slug · a repo#num / #num PR ref · free text
  ],
  "priorSessions": ["<old-resumeId>", …],   // sessions that previously owned this work (handoff); their transcripts stay discoverable
  "nextAction": "get Sarada's review, then promote api→master",
  "notes": "",
  "createdAt": "2026-07-22T…Z",
  "updatedAt": "2026-07-22T…Z"
}
```

`lastKnown` is a **cache of derived state** — overwritten on every `refresh`/`view`.
It exists so an offline cockpit still shows something; it is never the source of truth.

## Workstream states (`.state`, hand-set via `set --state`)

`in-progress` → `blocked` → `awaiting-review` → `approved` → `merged` →
`deployed` → `verified` → `done`

These are your *intent* about the workstream. The per-PR `lastKnown.state`
(OPEN / MERGED / CLOSED) is derived live and independent — the cockpit shows both.

## Priority ranking (cockpit sort order — lower = more urgent)

| Rank | Emoji | Condition | Meaning |
|-----:|:-----:|-----------|---------|
| 0 | ❌ | any PR `ci=failing` | CI is red — fix first |
| 1 | ✅ | any PR OPEN, not draft, `review=APPROVED`, `mergeable=MERGEABLE` | ready to land |
| 2 | 🚢 | any PR MERGED and `deploy.status≠deployed` | merged, not on staging yet |
| 3 | ⏳ | any PR OPEN, not draft | awaiting review |
| 4 | 📝 | any PR draft | still drafting |
| 5 | 🌱 | no PRs yet (and not done) | in progress |
| 6 | 🚀 | all PRs MERGED + deployed | verify, then archive |
| 7 | ✔️ | no PRs and state ∈ {verified, done} | done |

Ties break by `updatedAt`. Ranking is computed in `wip.sh` (`_JQ_RANK`).

## Live refresh contract

**PR status** — `gh pr view <n> --repo rock-of-eye/<repo> --json
state,isDraft,mergeable,reviewDecision,statusCheckRollup,mergeCommit,url`.
CI is collapsed from `statusCheckRollup`: any FAILURE/CANCELLED/TIMED_OUT →
`failing`; any not-yet-complete → `pending`; all complete & green → `passing`;
none → `none`.

**Deploy status** (best-effort, staging only):
- Host map: `rock-of-eye-api`→`api`, `rock-of-eye-sso`→`sso`,
  `rock-of-eye-pms-core`→`pms-core`. **Portals are not in the map → always `unknown`**
  (they don't stamp `build-info.txt`).
- `curl https://<host>.roe-staging.com/build-info.txt`, extract the first
  7–40 char hex token (`GIT_SHA`), compare its 7-char prefix to the PR's
  `mergeCommit.oid`. Match → `deployed`, mismatch → `not-deployed`, any failure
  (no network, no stamp, unmerged) → `unknown`.
- Only checked when the PR is `MERGED`. Prod (`master`/`workflow_dispatch`) is
  never auto-checked in v1.

## Commands

| Command | Purpose |
|---------|---------|
| `wip.sh view` | refresh all + render cockpit (the everyday command) |
| `wip.sh register [--name --linear --state --next --slug]` | create/update this session's record (auto-captures session) |
| `wip.sh add-pr --slug --repo --number [--target]` | attach a PR |
| `wip.sh set --slug [--state --next --notes --name]` | update workstream fields |
| `wip.sh depends --slug --on <ref> [--note]` / `--remove <ref>` / `--clear` | mark blocked on a session / PR / text |
| `wip.sh refresh [<slug>\|--all]` | live-refresh without rendering |
| `wip.sh list` | enriched, priority-sorted JSON (for tooling) |
| `wip.sh render` | render cockpit from cache, no refresh (offline-safe) |
| `wip.sh handoff <slug>` (aliases `resume`, `continue`) | brief + take ownership in a fresh session; old id → `priorSessions`; prints prior transcript path |
| `wip.sh archive <slug>` | move to `archive/` |
| `wip.sh rm <slug>` | delete a record |
| `wip.sh path <slug>` | print a record's file path |

Env: `WIP_DIR` (default `/workspace/.wip`), `WIP_GH_ORG` (default `rock-of-eye`).

## Planned v2 — automatic capture

v1 is manual invoke. v2 candidates (hooks run shell, not the agent, so they're a
separate mechanism):
- A Claude Code **`Stop` hook** that upserts the current session record on each turn.
- A **`gh pr create` wrapper** that auto-attaches a PR to the active session.
- Optional roll-up of the cockpit into the user's auto-memory.
