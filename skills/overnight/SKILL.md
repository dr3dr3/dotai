---
name: overnight
description: Prepare or execute an explicitly selected batch of unattended Firstmate work, with isolated implementation, recorded assumptions, no landing or runtime changes, and a morning debrief. Use when the user asks for overnight work or preparation for an unattended work session.
---

# Overnight work

Support daytime preparation, unattended execution, and morning review.
Determine the requested phase from the captain's message.
Discussing or preparing overnight work does not start execution.

This skill supplies the overnight work policy inside Firstmate.
Use the active Firstmate home's existing instructions, delegation, approval, and supervision mechanisms.
Outside Firstmate, prepare a bounded handoff for the owning session; do not become a second coordinator or send messages without authorization.

## Prepare

Identify the selected tasks and preserve their agreed priority, scope, acceptance criteria, dependencies, and design decisions.
Record which validation can run without affecting shared runtime.
Reuse existing plans rather than requiring the captain to repeat them.

Resolve missing information only when it prevents safe progress.
Record any supplied deadline or spending limit.
If none is supplied, keep work bounded to the selected batch; do not invent additional tasks or promise a timed stop without a verified mechanism.
Record a concise handoff in the home's existing durable task records, with links to the plans and expected deliverables.

## Execute

Require verified Firstmate lock ownership and working supervision before dispatching or changing fleet state.
Follow Firstmate's existing delegation and project delivery rules.
Persist the selected batch and its restrictions in the task briefs so workers and resumed sessions retain them.

Allow investigation, implementation, commits, and approved validation in isolated worktrees.
Prepare draft PRs only when publishing is authorized and their automation is known to respect the overnight restrictions.
Otherwise preserve a reviewable branch.

Do not merge or land changes, deploy, migrate, change infrastructure, alter shared services, or run stateful shared-runtime validation.
These task restrictions apply even where standing merge authority exists.
Do not bypass project gates, access credentials, or broaden permissions to keep moving.
Preparing infrastructure code for review is allowed when explicitly in scope; applying it is not.

Make implementation assumptions when they fit accepted intent, have bounded consequences, and can be revised locally.
Record consequential assumptions with their rationale, affected work, and cost of revision.
Routine coding choices do not need an exhaustive diary.
Hold decisions that expand scope, change agreed product behavior, or require authority the captain has retained, using Firstmate's existing decision procedure.

When blocked, preserve progress and record the exact question.
Continue independent portions or the next selected task.
Bound retries; retry only when new evidence justifies it.
Stop new work when the batch is ready, remaining work is blocked, or an agreed limit is reached.
Preserve unlanded work and record its current state; do not tear it down to finish the overnight session.

Load the active home's existing afk skill and use it for unattended supervision.
If that skill or its supported supervision mechanism is unavailable, report the blocker; do not claim unattended supervision is active.
Do not duplicate afk's lifecycle or treat away mode as extra authority.
The host and agent sessions must remain operational; this skill does not schedule execution or keep a sleeping host running.

## Debrief

On the captain's return, follow afk's return procedure when active.
A normal message such as "I'm back; debrief me" is the return signal; no separate /back command is needed.
Present completed work and artifact links, validation evidence, consequential assumptions, unresolved decisions, and recommendations.
Distinguish review-ready work from incomplete or unverified work.
Include any supervision interruption that affected progress or confidence.

Morning review does not itself authorize landing or runtime changes.
Obtain the captain's actual instruction for those next actions.
