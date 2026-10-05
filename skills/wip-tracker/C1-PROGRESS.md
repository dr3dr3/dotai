# C1 continuity foundation — implementation evidence and integration handoff

Owner: this separate Concierge implementation conversation, directly with André.
Accepted 2026-09-28. Lane: personal independent tooling in dotai. No commits/pushes.
This file is the session's progress record; the global accepted briefs remain
owned by the original pilot implementation conversation.

## Receiver understanding

Accepted the bounded record/protocol foundation: local SQLite, explicit store
initialisation, idempotent registration/events, immutable semantic checkpoints,
revision-checked receiver acceptance, navigable views and inert lifecycle/launch
fixtures. The installed skill, `wip.sh`, legacy records and sibling pilot work stay
unchanged. No live store, launch, runtime, service, migration, network probe,
sandbox change, polling, Linear duplication, scheduler or Jev.

Accepted the additive outcome-flow extension: one shared store, outcome/thread/
origin relationships, immutable scope revisions and authority, independent done
conditions, concrete parallel actions, confirmed/proposed/unknown actors, evidence
observation times, explicit completion, and optional follow-ups independent of the
finish line. Concierge owns records; Danny's view is derived and advisory. All
Production House facts are dated inert examples, not current verification or work
authorisation. The four conditions and all eight extension checks have fixtures.

Accepted the additive offline adoption-feedback extension: shared atomic claim,
one request/outcome, claim consumes cooldown, no uncertain re-prompt, explicit
prompt/answer states, spontaneous unrated remarks, bound delayed answers,
collector-confirmed saved acknowledgement, scoped review, and tested retention,
deletion and backup recovery. No live collection or prompts. No additional store,
crew or access grants. Settings below remain proposed for André's live approval.

Accepted the AI-Think offline handoff on 2026-09-30: intention and exit condition
are required in the handoff brief before acceptance; actual exit evidence and
remaining gap live in semantic checkpoints. Three modes and explicit revisions
are now in the same C1 store, with no new agent authority or live interaction.
See `AI-THINK-C1-HANDOFF.md` for exact shared-template placement and the single
manual P4/P6 review route. The shared charter remains owned by the sibling
session and was not edited here.

Sources read:

- `/workspace/ai-context/plans/active/macbook-pilot-records/concierge-and-work-continuity.md`
- `/workspace/ai-context/plans/active/2026-09-concierge-continuity-foundation.md`
- `/workspace/ai-context/plans/active/macbook-pilot-records/outcome-flow-and-next-actions.md`
- `/workspace/ai-context/plans/active/macbook-pilot-records/adoption-feedback-integration.md`
- `/workspace/ai-context/reference/conventions/local-ai-adoption-feedback.md`
- `/workspace/ai-context/plans/active/macbook-pilot-records/interaction-modes-and-learning.md`
- `/workspace/ai-context/plans/active/macbook-pilot-records/feedback-loops-and-evaluation.md`

Coordination status was read initially, after recovery, and after scope additions:
runtime available, reservation required for runtime operations. None performed.
The tool sandbox could not create its namespace; approved tool execution outside
that broken sandbox was used for local reads and temporary fixture tests. No
sandbox policy/profile was edited.

## Source and protocol

- `scripts/continuity.py`: schema version 2, trusted operator CLI and store API.
- `scripts/continuity_feedback.py`: feedback protocol in that same database;
  fixture-only collector/outbox simulation, proposed settings, deletion/restore.
- `scripts/continuity_fixtures.py`: temporary-store demo and inert lifecycle/
  launch producer. No supported live harness adapters are claimed.
- `tests/test_continuity.py`, `tests/test_continuity_feedback.py`, and
  `tests/fixtures/production-house.json`: offline evidence.

Python standard library only. Store parent must be owner-held 0700 and database
0600. Explicit `--db` is required; opening a missing store never creates it. No
default XDG path is activated. SQLite foreign keys, rollback journal, 3-second
busy timeout, schema fingerprint/version checks and immediate write transactions
bound mutation. There is no multi-machine sync or network filesystem support.

`apply` reads one JSON event on stdin, with envelope `id` (UUID), `sequence`
(nonnegative producer sequence), `kind`, `subject` (UUID), `time` (ISO timestamp),
and `payload`. Trusted caller supplies `--producer`, `--kind` and `--session`.
These flags are operator inputs, **not authentication for restricted sessions**.
C2 must derive them from the bound channel, never the contributed JSON.

Commands: `init`, `apply`, `query`, `view`, `outcomes`, `backup`. Mutation event
kinds: `register`, `bind-provider`, `open`, `observe`, `checkpoint`, `prepare`,
`send`, `clarify`, `accept`, `cancel`, `revise-engagement`, `launch-request`, `launch-result`,
`outcome-scope`, `complete-outcome`. Each dispatch branch explicitly validates its
allowed fields. Tests and demo provide executable examples of every main path.
Errors are JSON (`ok:false`, `error.code`, `error.message`) with exit code 2.

Thread record revision and assignment revision are separate. Handoff brief
revision and state revision are separate: retry keeps the brief revision;
substantive replacement creates another immutable brief revision. Only the latest
revision may accept. Acceptance atomically records receiver understanding,
checkpoint and coordinating-session change. Session observations cannot transfer
ownership or complete work. A checkpoint may change disposition only with an
explicit human-approval reference; these references do not grant runtime powers.

General events retain payload hashes, provenance, event/receipt times and durable
success/rejection results. Exact replay returns its prior result; reused ID or
producer sequence with changed content conflicts. A rejected stale event requires
a new event ID after a fresh read. Checkpoints and scope revisions are immutable.
Normal views open read-only and perform no external queries.

Feedback uses separate transactional tables **within the same database**, so raw
answers never enter the append-only general event payloads or diagnostics. Active
feedback receipts validate payload hashes; deletion/expiry removes those hashes
and retains minimal identity/sequence suppression markers. Replaying an erased
event is a suppressed no-op, never an old saved acknowledgement or resurrected
rating. Replaying a claim cannot grant another display permission.

The fixture collector accepts a trusted bound session/producer, rejects spoofed
identity fields and context mismatch, and checks compact content. The basic
secret-like-pattern rejection is defense in depth, not a comprehensive secret
detector. Live redaction/collector access enforcement remains a C2 requirement.

## Proposed feedback activation settings (not enabled)

| Setting | Fixture default |
|---|---|
| Live switch | Disabled; no live enable command |
| Shared cooldown | 24 hours, trusted collector clock |
| Per outcome | One request; handoff/resume never resets it |
| Unconfirmed claim | Unknown after 10 minutes; no retry/display permit on replay |
| Quote/context | Optional quote ≤512 characters; context ≤2 KiB |
| Feedback content | 90 days from receipt |
| Acknowledged transport | 24 hours |
| Pending transport | 7 days; expiry reports lost capture, not saved |
| Diagnostics | 30 days; fixed codes, no raw payload |
| Backups | Owner-only, at most 7 days; deletion/expiry reapplied on restore |
| Review | Owner/trusted collector; explicitly authorised bounded Concierge review |
| Danny | Outcome evidence only, no raw feedback access |
| Trial window | Proposed 14 days; André selects a real journey before activation |

Skip and silence are not ratings. Clock rollback, uncertain pause/outcome, another
pending question, shared cooldown and suppression omit prompting. Spontaneous
feedback consumes no extra question or claim and suppresses later prompting for
the same outcome. A late answer uses the original request/outcome/checkpoint,
including after an accepted handoff; expired/mismatched context is rejected.

Deletion removes live content and supplied fixture outbox copies; minimal
non-content markers prevent replay. Full feedback-identity purge leaves a global
omit flag: an old work identity cannot silently regain prompting eligibility.
Backup content may remain for up to 7 days unless immediate purge is requested;
physical forensic erasure is not claimed. Snapshots are sealed and rejected by
normal Store opening. Restore requires the current same-lineage deletion ledger,
applies deletion/expiry before unsealing, and does not replace the source store.
If that ledger is unavailable, restore of feedback must not be guessed safe.

## Validation and inspectable evidence

Validation on 2026-09-30: **60 tests passed** (29 continuity/outcome/AI-Think,
31 feedback), in approximately 2.5 seconds. The standalone temporary-store demo
also passed. Whitespace checks emitted no errors; existing
`SKILL.md` and `scripts/wip.sh` have no diff. No installed hooks or live harness
coverage is claimed.

Additional hardening proved: missing/unrelated deletion-ledger refusal, deletion
before outbox ingestion, no redisplay from a recovered claim, no false saved ACK
for feedback newer than a restored snapshot, bounded review excluding out-of-window
usage, immutable verified provider binding, and structured missing-store errors.

No commits were made. Base HEAD at the earlier inspection:
`256420a8d7d0f07ff652400ccabd78ea9764caa6`. Exact source SHA-256 fingerprints:

| File | SHA-256 |
|---|---|
| `scripts/continuity.py` | `87997fbb8767c817b6fe6241a52eee4d95b6c8f39ff14ea51875cb3158309e51` |
| `scripts/continuity_feedback.py` | `88674a2a67100a726318572427a5b376dacdb97e527cf66943535da6b492f084` |
| `scripts/continuity_fixtures.py` | `887d8adc69fe1d4913a6ff80a356aa561ae86d3649ef8dba64010a57d817f42c` |
| `tests/test_continuity.py` | `5752a1357a4021b0edfba53510728a76be12d565dfa8f97d38d697002736d5bc` |
| `tests/test_continuity_feedback.py` | `f1feefbb0d52b5d5d6204991d59d3ffd1b89d7a02c9836216f5c84380a8f5102` |
| `tests/fixtures/production-house.json` | `aac086d486de587b5a983605716141641491db93acc9fab8107c3b8eacb0344c` |

Reproduce offline checks from personal dotai:

```text
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s skills/wip-tracker/tests -v
PYTHONDONTWRITEBYTECODE=1 python3 skills/wip-tracker/scripts/continuity_fixtures.py
```

The demo prints acceptance, parked rediscovery, direct entry/abrupt exit and the
four-condition historical outcome view. Its database exists only in a temporary
directory and is removed at exit. Tests exercise real separate SQLite writer
processes and abrupt process exit before/after commit; no actual agents launch.

## Deferred C2 handoff — no installation edits made

1. Add stable personal catalogue role `concierge`, referencing the agreed charter;
   retain all verified profile/provider/restore ownership in the original session.
2. Replace the installed continuity/intake skill only in an approved integration
   slice. Draft workflow: resolve/create stable work identity at supported entry;
   contribute semantic checkpoints at meaningful transitions; state multiple
   concrete actions and their actor/destination/evidence; never infer assignments;
   accept exact handoff revision before execution; suggest manual intake closure
   only after durable acceptance/destination/checkpoint. Optional work stays optional.
3. Concierge charter/intake draft: intake/navigation and record usefulness; Danny
   advisory outcome/finish-line interpretation; neither sets priorities, assigns
   developers, transfers runtime ownership or executes suggested actions by rendering.
4. Bind supported launch/lifecycle and outbox producers through the verified
   trusted launcher/collector. Verify provider identity before generating resume
   references. Enforce directory-to-session/assignment binding, bounded file sizes,
   traversal/symlink refusal, permitted event families and prompt ingestion while
   destination remains open. Restricted roles get no broad DB reads/writes.
5. Real launch/resume policy must check catalogue/profile, registered destination,
   existing execution ownership and approved outer boundary. Unknown/still-live
   executors trigger discovery, not duplication. C1 requests are inert records;
   fixture profiles are not installed policies.
6. Feedback C2 must load the personal instructions on both Concierge and supported
   direct entry, connect atomic eligibility responses and saved acknowledgements,
   enforce live access/redaction/retention including every outbox/backup location,
   and obtain André's settings approval and chosen journey before activation.
   Concierge review proposes one linked improvement/success signal; André decides.
7. Inventory and preserve any target legacy records before a separately authorised
   migration. Nothing here initializes `/workspace/.wip` or a live continuity DB.

C1 is complete for the accepted offline implementation scope, including the
outcome, feedback and AI-Think additions. All owned C1 files are under
`skills/wip-tracker`; pre-existing
dirty work was preserved. Sibling implementation continued adding its own files
during this session; none were edited, staged or committed here.

Recommended next interaction: André reviews this source/evidence and the deferred
C2 integration handoff in this conversation. Live settings approval and real-work
journey selection remain future integration decisions, not requirements to finish
this offline slice. No new session, scheduler, prompt or optional task is needed
to declare this agreed C1 scope complete.
