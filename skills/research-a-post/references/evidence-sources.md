# Evidence sources

Where the verifiable half of a brain-dump comes from, and how to get it.

Two rules run through all of it:

- **A source must be re-runnable.** Record the command, the path and line, the issue ID, the run
  number. `[git]` is a category. `git log --oneline a1b2c3d..e4f5g6h` is a source.
- **Gather the baseline with the number.** Every measurement needs its before, or it is not
  evidence. If the before does not exist, that is a `[[TK:]]`, not a reason to publish the after
  alone.

---

## What each archetype needs

The archetype decides which seams are worth mining. Gathering the wrong ones produces a long file
that supports nothing.

| Archetype | The evidence it lives or dies on | Where it usually is |
| --- | --- | --- |
| **war-story** | The attempts that **failed**, in order, with what each cost. Mandatory — a war story without them is an announcement. | Reverted commits, closed-unmerged PRs, abandoned branches, Won't Do issues, incident timelines |
| **decision-record** | The **date** of the call, and each option stated fairly enough that its advocates would recognise it | ADRs, PR and issue discussion threads, the state of the tools *on that date* |
| **teardown** | The **version tested**, the scale it was used at, and the edges it hit | Lockfiles at the time, upstream issue tracker, the errors it actually threw |
| **field-note** | One measurement, and the specific circumstance that makes it true | Wherever the number is. Usually one query and one artefact |

If what you find does not support the archetype, say so and re-propose. Do not pad a war story with
successes.

---

## Git — the spine

The most reliable source available, and the most frequently over-read. It carries dates, sequence,
size and authorship. It does not carry intent.

```bash
# Sequence and real dates for a path
git log --date=short --format='%ad %h %an %s' -- <path>

# When something first appeared, and when it was deleted
git log --diff-filter=A --date=short --format='%ad %h %s' -- <path>
git log --diff-filter=D --date=short --format='%ad %h %s' -- <path>

# What got thrown away — reverts are the cheapest signal there is
git log --grep='^Revert' --date=short --format='%ad %h %s'

# How much moved between two points
git diff --shortstat <before>..<after>
git diff --stat <before>..<after> -- <path>

# The versions as they were pinned AT THE TIME, not now
git show <sha>:package.json
git show <sha>:pnpm-lock.yaml
git log --date=short --format='%ad %h' -- composer.lock   # then diff two of them

# Branches that stopped
git branch -a --sort=-committerdate --format='%(committerdate:short) %(refname:short)'
```

**The trap.** Three commits taking three approaches is evidence that three commits landed. It is not
evidence of what was tried, in what order, for what reason, or that the same person made all three
calls. Bring the sequence to André as a **question**, never as a finding about him.

---

## GitHub

Pull requests carry the discussion that git does not — and closed-unmerged PRs are where abandoned
work is buried.

```bash
# Abandoned work: closed without merging
gh pr list --state closed --limit 100 \
  --json number,title,closedAt,mergedAt,url \
  --jq '.[] | select(.mergedAt == null)'

# One PR's full timeline, including review comments
gh pr view <n> --json title,createdAt,mergedAt,closedAt,additions,deletions,reviews,comments

# CI durations — start and end, so you can compute the delta yourself
gh run list --workflow=<file.yml> --limit 50 \
  --json databaseId,workflowName,conclusion,startedAt,updatedAt,headBranch

# The failing log itself, for an artefact
gh run view <run-id> --log-failed
```

Compute durations from `startedAt` and `updatedAt` rather than quoting a remembered figure, and say
in the caption how many runs the figure came from. One run is an anecdote; state that it is one.

---

## Linear

Prior decisions, when work was picked up and dropped, and what got explicitly rejected.

`LINEAR_API_KEY` must be set; the endpoint is `https://api.linear.app/graphql` and the header is
`Authorization: $LINEAR_API_KEY` with **no** `Bearer` prefix. Use Python with `json.dumps` to build
the payload so escaping is safe — the same pattern as the `linear-*` commands in this repo.

Worth querying for:

- Issues in **Won't Do / Cancelled** touching the area — the rejected options for a decision record.
- `createdAt` and `completedAt` on the issue that tracked the work — real dates for the timeline.
- Comment threads on the deciding issue — the options as they were stated at the time.
- Whether a prior decision already settled this, which changes the post.

**Read only. Never run a mutation.** And quote the comment text you need inline in the brain-dump —
a Linear URL is a valid source tag, but the drafting session cannot open it.

---

## Sentry

The best source for "how it was noticed" and "how bad it was", both with real timestamps.

Per issue: `firstSeen`, `lastSeen`, `count`, `userCount`, and the culprit. `firstSeen` against the
deploy time is often the whole story — and `firstSeen` long before anyone noticed is a better story
still.

If `SENTRY_TOKEN` or the org is not configured, note the gap in the brain-dump and move on. A missing
source is a recorded gap, never a reason to estimate.

---

## The rest

| Source | What it gives | Note |
| --- | --- | --- |
| **Lockfiles** | Exact versions as pinned on a date | Always via `git show <sha>:<lockfile>` |
| **CI config history** | When a step was added, and what it replaced | `git log -p -- .github/workflows/` |
| **Cloud bills** | Cost lines, itemised, with a before | Scrub the account ID; keep the shape and the figure |
| **Dashboards / APM** | Latency and throughput, before and after | Screenshot is not usable — the blog publishes text. Get the numbers |
| **In-repo docs, ADRs** | The reasoning as recorded at the time | Far better than reconstructing it |
| **Upstream issue trackers** | Known edges of a tool, for a teardown | Quote the issue text and number |

---

## What no source can tell you

Do not go looking for these, and do not infer them. Ask.

- Why an approach was chosen, or abandoned.
- What he believed at the time, as distinct from what turned out to be true.
- What the work cost him — the weekends, the arguments, the thing that got dropped instead.
- Whether he would do it again.
- What "noticed" felt like from the inside.

Evidence dates the story. It never narrates it.
