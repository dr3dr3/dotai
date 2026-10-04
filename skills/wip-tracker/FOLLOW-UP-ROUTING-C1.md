# Offline Concierge follow-up routing

This is a source-only addition to the TypeScript C1 continuity store. It does
not install a role contract, initialise a live store, launch an agent or grant
runtime authority. It implements the accepted AI-Think follow-up design in
`rock-of-eye/ai-context` draft PR #231, commit `baf4e0d`, section
“Follow-ups discovered by a working session”.

## Working-session closeout contract

A semantic checkpoint may add `closeout` alongside its existing `actions`:

```json
{
  "primary_action_id": "collect-evidence",
  "candidates": [
    { "action_id": "collect-evidence", "benefit": "Finish agreed result", "estimate": "small" },
    { "action_id": "improve-summary", "benefit": "Clearer later review", "estimate": "uncertain" }
  ]
}
```

Each candidate refers to exactly one classified semantic action. The action's
`text` is its first concrete step; its category, actor, destination,
dependencies, contribution and evidence remain in the existing action record.
Every action in a closeout must have a benefit and size/uncertainty estimate.
Exactly one is primary. If any required or waiting action remains, the primary
must be one of them. This contract is optional for legacy checkpoints, whose
single `next_action` is still readable.

`outcomes --compact` puts required and waiting actions first and reports an
optional/separate candidate count. Add `--candidates` to expand the candidate
group with benefit, estimate, immutable checkpoint/action origin and selected
branch, if any. JSON outcome views retain the full `actions` array and expose
`active_actions`, `candidates`, `selected_branches` and `active_wip_threads`;
unselected optional ideas never add an active thread. Required actions on
closed threads appear as reconciliation items; parked threads and branches are
shown separately and do not count as active WIP. A selected open branch is
visible with its proposed first action even before the first checkpoint. These
are Danny advisory views over Concierge-owned records.

## Explicit branch selection

The trusted local C1 `select-candidate` event takes a source checkpoint and
optional/separate action ID, a fresh outcome ID and new thread ID (the event
subject), title, done conditions, reason, current coordinator and an explicit
`human-approval` authority link. The source coordinator must submit it
from the current checkpoint; a later checkpoint supersedes the candidate list,
so still-available ideas must be carried forward explicitly. One transaction
reuses the existing `outcome-scope` and `open` validations and creates a new
outcome and origin-linked thread. The new thread carries an
immutable `origin_action` pointing to the source checkpoint and action. Direct
`open` events cannot set that action origin. The branch stays in its current
coordinator's session until the existing prepare/send/accept handoff changes
ownership; selection grants no launch permission.

The event journal serializes writers and rejects a second successful
activation of the same source thread/action ID, even when the suggestion is
copied into a later checkpoint. Exact event replay returns the original
result. A different event cannot create another accepted branch. Other routes
(continue in the current session or use an existing owner session) remain
ordinary checkpoint/handoff decisions; they do not silently create a branch.
This offline event does not yet define how a later Concierge intake selects an
idea after the source session exits. P4 must specify a trusted operator or
receiver route with human approval and correct provenance before live wiring.

The offline fixture demonstrates a required discovery leading Danny's next
move, an optional idea remaining outside active WIP, evidence and acceptance
closing the original outcome, André's explicit selection creating a separate
origin-linked outcome, and replay/second-selection protection. At P4/P6 the
pilot owner can review one real closeout manually with André after separate
live integration approval; this slice performs no live review or prompting.
