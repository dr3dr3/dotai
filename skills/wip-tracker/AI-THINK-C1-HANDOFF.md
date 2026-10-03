# AI-Think offline C1 handoff

Accepted 2026-09-30 by this Concierge implementation receiver. Sources:
`/workspace/ai-context/plans/active/macbook-pilot-records/interaction-modes-and-learning.md`
and `/workspace/ai-context/plans/active/macbook-pilot-records/feedback-loops-and-evaluation.md`.
This is personal independent tooling work. It does not install a skill, initialise
a live store, dispatch a role, prompt for feedback, schedule reviews or change
Concierge/Firstmate authority.

## Implemented placement

- The C1 `prepare` brief requires `mode` (`collaboration`, `facilitation` or
  `service`) and a nonempty `exit_condition` before `send`/`accept`. The accepted
  handoff revision remains immutable; `accept` appends the next engagement revision
  for the thread. The receiver's understanding stays in the existing acceptance
  event. Clarification and revision before acceptance use the existing handoff
  revision and state checks.
- After acceptance, `revise-engagement` requires current coordinator ownership,
  matching thread/assignment/engagement revisions, a reason and an explicit
  authority reference. It appends an immutable engagement revision and increments
  assignment revision. It does not relabel the accepted brief. Stale exit evidence
  cannot satisfy the new agreement.
- Existing semantic checkpoint content optionally carries `engagement_exit`:
  `{revision, assessment: met|unmet|unknown, evidence: typed links, remaining,
  next_action}`. Met and unmet assessments require evidence. Unmet and unknown
  require the remaining gap and next action. `query` returns current agreement,
  revision history and the latest matching exit evidence; `view` prints the
  intended mode/condition and actual assessment, evidence, gap and next action.
  Closing a thread or observing a session exit does not create exit evidence.
- C1 schema is now version 2. No live store exists in this slice, and there is no
  version-1 migration. Existing version-1 files fail closed until migration is
  separately designed and authorised.

The current C2 child collector permits checkpoint and handoff contributions,
but not `revise-engagement`. A post-acceptance mode change is available only in
the trusted local C1 API with an asserted current coordinator; the CLI flags do
not authenticate a role. Exposing a bounded receiver contribution would require
a separate collector grant and integration review; this offline slice does not
silently widen child authority.

## Shared charter/template installation handoff

The shared source `/workspace/ai-context/reference/taxonomy-topology/ai-pilot-role-charters.md`
remains owned by the sibling implementation session. Its **Consultation request
template** should insert `Intended interaction mode:` and `Agreed exit condition:`
immediately after `Question and required output:` and before `Sources and
revisions/as-of times:`. The request revision must change if either changes
before acceptance. The **Consultation result template** should insert `Actual
exit assessment and evidence:` and `Unresolved exit gap, owner and next action:`
after `Evidence links and source revisions:`. The **Checkpoint template** should
insert `Current mode/exit agreement revision:` after `Current assignment and
objective:` and `Actual exit assessment, evidence, remaining gap and next action:`
after `Completed outputs and evidence:`. These are proposed exact placements,
not edits to that shared file. Acceptance wording should require the receiving
role to acknowledge the mode and exit condition alongside the bounded scope.

## One manual P4/P6 review route

At a natural P4 or P6 pilot review, the owner/Concierge reads a small, explicitly
chosen sample of authorised thread records through C1's read-only `query` or
`view` (for an offline fixture: `node skills/wip-tracker/scripts/continuity_cli.ts query --db <private-fixture-store> --thread <thread-id>`). For each, compare the
accepted mode and exit condition with the latest matching `engagement_exit`, its
source links, and the actual outcome done conditions. Mark absent exit evidence
as unknown and retain any unmet dependency with its owner and next action.
Separate observed facts from the interpretation of whether the mode served the
work. Record **one** proposed reusable change, a responsible owner and an
observable success signal; André decides whether it becomes authorised work.
No automatic score, dashboard, telemetry, broad role DB access or launch follows.
Danny may use the derived advisory outcome view; Concierge owns the underlying
record. Production House examples remain dated fixtures, never live evidence.

Offline acceptance fixtures cover all three modes, a changed mode before
acceptance, an explicit revision after acceptance, stale exit evidence, an unmet
exit, and a closed session/thread with no exit evidence. The TypeScript suite and temporary-store demo passed on 2026-10-03.
