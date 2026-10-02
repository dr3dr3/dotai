# Concierge continuity foundation (offline C1/C2)

This package is a source-only foundation for local work continuity. It is not
installed into `wip.sh`, the current skill, the role launcher or a running
agent. No store path is selected or initialized by this change. The Python
scripts use only the standard library and require an explicit database path.

## What the records mean

`scripts/continuity.py` owns one local SQLite store. It records sessions,
threads, outcome/thread/origin links, immutable semantic checkpoints and
revision-checked handoffs. An exact event replay returns its durable result;
reuse of an ID or producer sequence with different content conflicts. A receiver
must accept the current handoff revision before becoming the coordinating
session; the C2 collector checks that acceptance against its bound channel.
Lifecycle observation and resume references remain
evidence, not permission to launch or execute work.

Outcome scope has explicit revisions, authority and independent done conditions.
Checkpoints can name several concrete actions, each with category, actor status,
destination, dependencies and evidence. Optional follow-ups do not extend the
agreed finish line. The read-only derived outcome view is advisory for Danny;
Concierge owns the underlying records.

A handoff brief requires intended interaction mode (`collaboration`,
`facilitation` or `service`) and an exit condition before acceptance. An explicit
post-acceptance revision preserves the original agreement and revises the
assignment. Checkpoints can record actual exit evidence, unmet gap and next
action. Closing a thread or observing a session exit does not prove the exit
condition. [AI-THINK-C1-HANDOFF.md](AI-THINK-C1-HANDOFF.md) gives the deferred
shared request/result/checkpoint template placement and a manual P4/P6 route.

The store schema is version 2. It rejects missing, corrupt or wrong-version
stores and snapshots on normal open. There is no migration from version 1 or
legacy WIP data. The selected store must live on one local filesystem in a
private owner-held directory; backups and restore have separate guarded APIs.

## Feedback remains disabled

`scripts/continuity_feedback.py` adds transactional feedback tables in the same
store, but no live prompt, hook or collector is installed. Its fixture defaults
are proposals for later approval: shared 24-hour cooldown, one request per
outcome, an unconfirmed claim becoming unknown after 10 minutes without retry,
90-day content retention, optional quote up to 512 characters and context up to
2 KiB, 24-hour acknowledged and 7-day pending outbox retention, 30-day
non-content diagnostics, and backups kept at most 7 days with deletion reapplied
on restore. Minimal non-content suppression markers prevent re-prompting or
replay resurrection after deletion. Skip, silence and spontaneous unrated
feedback remain distinct. Owner/trusted collector access and explicitly
authorised bounded Concierge review are modeled; Danny has no raw feedback
access by default. Live settings, access enforcement across every outbox and
backup location, and a real journey still need separate approval and wiring.

## C2 transport boundary

`scripts/continuity_collector.py` is a trusted, one-shot filesystem collector.
An operator-held binding names a registered session, stable producer, private
outbox/receipt inbox and exact thread/assignment grants; a receiver grant also
names the handoff revision. The role contributes bounded JSON files only. The
collector validates file ownership, modes, type, links, path components, size,
provenance and assignment in the same write transaction as the store event,
then publishes an atomic receipt. Its child channel permits checkpoints and
handoff transitions. It exposes no broad DB reads/writes, feedback event family,
launch, lifecycle observation, polling loop or `revise-engagement` grant.
Trusted operator CLI flags are inputs, not authentication for restricted roles.

## Reproduce offline evidence

From the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s skills/wip-tracker/tests -v
PYTHONDONTWRITEBYTECODE=1 python3 skills/wip-tracker/scripts/continuity_fixtures.py
```

The 60 tests use temporary stores and local inert processes. They cover
idempotency, competing acceptance and checkpoint writers, stale assignments,
the outcome-flow acceptance cases, all three interaction modes and missing or
unmet exit evidence, collector path/provenance/receipt failures, and feedback
claim/replay/crash, silence, delayed binding, deletion and backup restore. The
demo includes dated Production House evidence solely as a fixture; it authorises
no live read, mutation, implementation or release.

Activation remains a later integration decision: verify the launcher/provider
identity and restore boundary, install narrow role grants and a trusted binding,
choose and initialize a private live store explicitly, and approve feedback
settings and a real-world journey. This PR does none of those actions.
