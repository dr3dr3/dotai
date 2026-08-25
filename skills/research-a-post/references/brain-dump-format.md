# Brain-dump format

One self-contained markdown file. It gets carried into the blog repo as
`drafts/<slug>.brain-dump.md`, where a `drafter` skill writes the post from it and a `fact-checker`
skill traces every published number back to it.

Two consequences shape the format:

- **The drafting session sees nothing but this file.** No links resolve. No repo is available. If a
  fact is not in here, it does not exist.
- **The fact-checker cites by line** — "L18 'six agents' — brain-dump line 4". So the evidence
  section is a **numbered list, one fact per line**. Do not bury a number mid-paragraph.

---

## Template

````markdown
# Brain-dump: <slug>

Idea: <his one sentence, his words>
Reader: <alias> — <the class they stand for>
Terminal reader: <who receives it, if the reader forwards. Omit if not applicable>
Moment: <what they are in the middle of, or "none — feed reader">
Archetype: <war-story | decision-record | teardown | field-note> — <one line of reasoning>
Researched: <YYYY-MM-DD> in <which repo / environment>

## Scrub before drafting

Everything here is real and unscrubbed. Each becomes a shape, not a name, when the post is
written — see WRITING.md §8.

- <Company name> → a <shape: "fifty-service C# platform across two timezones">
- <colleague name> → unnamed, or omitted
- <internal-service-name>, <hostname>, <TICKET-123> → svc-a, internal-registry, elided

## Evidence

Numbered, one fact per line, each with a source someone else could re-run.

1. <fact> — `<command | path:line | ISSUE-ID | run 4412>`
2. <fact, with its baseline> — `<source>`
3. ...

## Artefacts

Real output only. Trimmed with `...`, never reconstructed.

### A1 — <what it is>
Source: <what produced it, and when>
Scrubbed: <what was replaced, or "nothing">

```
<the actual text>
```

## André's account

Verbatim. Not tidied, not arranged into an argument, not turned into prose.

**What existed before**
> <his words>

**How it was noticed**
> <his words>

**What I tried first**
> <his words — the attempts that failed, in order, with what each cost>

**What worked, and what it cost**
> <his words>

**What I'd do differently**
> <his words>

## Open questions

Each answerable in one sentence.

- [[TK: <the specific missing fact>]]
- [[TK: <...>]]

## Not found

Sources checked that came back empty or unavailable, so nobody checks them twice.

- <source> — <why: unavailable, no matching records, out of retention>
````

---

## Rules for filling it in

- **Evidence and account stay separate.** The moment a researched fact is written inside a `>` quote
  in his account, it becomes something he said. That is the failure this format is built to prevent.
- **Quote him, do not summarise him.** "It was a shocker" is material. "He felt it went badly" is
  not, and the drafter cannot use it.
- **Reference artefacts by ID** from the evidence list — "3. Build time went 9 min → 4 min, see A2".
- **A `[[TK:]]` is a success.** Ten of them is a working brain-dump. Zero of them, when ten facts
  were missing, is a broken one.
- **Never write a section heading with nothing under it.** Put the `[[TK:]]` there instead, so the
  gap is visible rather than implied.
- **No prose for the post.** No title suggestions, no opening lines, no framing. The drafter starts
  clean, and a half-written opening in the raw material distorts it.

---

## Worked example

> **The figures and names below are invented to demonstrate the form.** Nothing here describes any
> real system, and no line of it may be copied into a brain-dump or a post.

````markdown
# Brain-dump: nightly-job-that-ran-twice

Idea: The nightly reconciliation ran twice for eight months and nobody noticed.
Reader: chops — managers whose people are ahead of the organisation's guardrails
Moment: about to inherit a scheduler nobody owns
Archetype: war-story — it was wrong for a long time, and the first two fixes made it worse
Researched: 2026-08-25 in the platform repo

## Scrub before drafting

- Northwind Freight → a mid-size logistics platform, ~40 services
- Priya (wrote the original schedule) → unnamed
- recon-worker-prod-02, JOB-4471 → svc-a, elided

## Evidence

1. The schedule was added on 2025-11-03 — `git log --diff-filter=A --date=short -- infra/cron/recon.tf`
2. A second schedule with the same target was added 2025-11-19, sixteen days later — `git log --date=short -- infra/cron/recon.tf`
3. Duplicate runs first visible 2025-11-20, last 2026-07-14 — Sentry `firstSeen` / `lastSeen`, issue PLAT-8821
4. 241 duplicate-run errors over that window, affecting 3 downstream services — Sentry `count`, issue PLAT-8821
5. First fix reverted after four days — `git log --grep='^Revert' --date=short` (2026-07-18 → 2026-07-22)
6. Reconciliation runtime before the fix: 34 min median over 20 runs. After: 31 min — `gh run list --workflow=recon.yml --json startedAt,updatedAt --limit 20`, both windows
7. [[TK: what did the duplicate runs cost in compute? The bill line was not accessible from this repo]]

## Artefacts

### A1 — the error the duplicate run threw
Source: Sentry issue PLAT-8821, most recent event, 2026-07-14
Scrubbed: hostname replaced

```
ReconciliationLockError: lock held by another run
  at Reconciler.acquire (recon/lock.rb:88)
  ...
  held_by: svc-a  age: 00:00:31
```

## André's account

**What existed before**
> One Terraform file, one schedule, nobody's name on it. It had been fine for a year so nobody
> looked at it.

**How it was noticed**
> A downstream team asked why their numbers moved twice a night. That was eight months in.

**What I tried first**
> Added a lock. That was the wrong layer — it just meant one of the two runs failed loudly instead
> of quietly, and it woke people up. Reverted it inside the week.

**What worked, and what it cost**
> [[TK: what was the actual fix, and what did it cost?]]

**What I'd do differently**
> [[TK: ]]

## Open questions

- [[TK: what did the duplicate runs cost in compute?]]
- [[TK: what was the fix that stuck, and what did it make worse?]]
- [[TK: was the second schedule added deliberately, or was it a merge that went wrong?]]

## Not found

- Cloud bill — not reachable from this environment
- The PR that added the second schedule — repository history was squashed before 2026-01
````

Note what the example does **not** do. Evidence line 2 records that a second schedule was added
sixteen days later. It does not say why, does not call it a mistake, and does not put that
sentence in André's mouth. It becomes an open question instead.
