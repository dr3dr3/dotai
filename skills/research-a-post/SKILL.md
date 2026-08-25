---
name: research-a-post
description: Research a blog post idea against the work environment and produce a brain-dump — the raw material and evidence a post gets drafted from. Gathers verifiable facts (git history, PRs, Linear, Sentry, CI, pinned versions, bills) with a re-runnable source on every one, captures artefacts verbatim, then interviews André for the half only he has. Use when he says "I might write about X", "research a post idea", "gather evidence for a post", "brain-dump for the blog", or names a thing at work he wants written up. Output is one self-contained markdown file to paste into the blog repo as drafts/<slug>.brain-dump.md. NOT for writing the post — that happens in the blog repo. NOT for Slack/Teams/email messages, which is draft-post.
---

# Research a post

You produce **one file**: a brain-dump. It is the entire supply of truth for a post that gets
drafted somewhere else, by someone else, from nothing but this file.

You do not write the post. You do not draft prose. You gather.

## The one thing to understand

A brain-dump has two halves, and you can only research one of them.

| | Where it lives | How you get it |
| --- | --- | --- |
| **Evidence** — what the system did, when, and by how much | git, PRs, Linear, Sentry, CI, lockfiles, bills, logs | You go and find it |
| **Experience** — what André tried, thought, decided, and what it cost him | Only in his head | You ask him |

**Git history shows what the repository did. It does not show what he thought.** A commit sequence
of three approaches is not evidence that he tried three approaches in that order for those reasons.
It is evidence that three commits landed. The reasons are his, and if he does not supply them, they
do not exist.

Reconstructing a narrative from evidence and presenting it as his experience is the one failure that
matters here. Everything below exists to prevent it.

## Why the bar is this high

Downstream, a `fact-checker` skill traces every number, date, version and quote in the draft back to
this file. **Anything in this file is treated as true.** A guess written here does not get caught
later — it gets laundered into a published post under his name.

So there is no middle confidence. Every line is one of two things:

- **Verified** — carries a source someone else could re-run: a command, `path/to/file.php:42`, an
  issue ID, a URL, a build number.
- **A question** — `[[TK: the specific thing that is missing]]`.

A category word is not a source. `[codebase]` is not a source; `Modules/Fitting/Fitting.php:42` is.
If you cannot say how you know it, it is a `[[TK:`.

## Before you research

Settle three things. They decide what evidence is worth gathering, so guessing them wastes the run.

1. **The idea, in one sentence.** His words. Do not improve it.
2. **The reader, and their moment.** Ask which reader in the blog's `docs/READERS.md` this is for
   and what they would be in the middle of. One reader, never a blend. If he will not name one,
   record `[[TK: which reader, and what moment?]]` and carry on — do not pick for him.
3. **A provisional archetype** — `war-story`, `decision-record`, `teardown` or `field-note`.
   Propose one with a sentence of reasoning; he confirms or overrides. See
   `references/evidence-sources.md` for what each one needs, because they need different evidence.

If the evidence you find later contradicts the archetype — a war story where nothing went wrong,
a teardown of a tool used for a weekend — **say so and re-propose.** Do not quietly gather the wrong
things.

## Gather

**Work claim-first, not source-first.** List the claims the post will have to support, then go find
each one. Dredging every source and seeing what turns up produces volume, not evidence.

1. **Write the claim list.** From the archetype's skeleton, what does this post have to prove? "The
   pipeline got slower." "Two attempts were rolled back." "It cost more than the thing it replaced."
2. **For each claim, find the number and its baseline.** A number with no baseline is not evidence.
   "Down to four minutes" means nothing without what it was before. Gather both or gather neither.
3. **Get the dates.** Real ones, ISO format, from git or the tracker. A decision record is a
   different post depending on whether the call was made before or after a tool shipped a feature.
4. **Get the versions as they were pinned at the time**, not as they are now. `git show <sha>:<lockfile>`.
5. **Look for what did not work.** Reverted commits, closed-unmerged PRs, abandoned branches,
   issues moved to Won't Do. This is the richest and least-visited seam, and for a war story it is
   the mandatory section. Note what you find — but the *reasons* are still his.

`references/evidence-sources.md` has the per-source detail and the commands.

## Capture artefacts verbatim

The blog publishes artefacts, not code: log excerpts, timing tables, error messages, cost lines,
pipeline output. They are the proof.

- **Paste the real output. Never a reconstruction.** A log written from a description is fabricated
  no matter how accurate it looks, and the fact-checker cannot tell the difference.
- **Trim, do not summarise.** Cut lines with `...`, keep the ones that carry the point.
- **Caption every one**: what it is, what produced it, and when.
- **Quote the content inline, always.** A Linear or Sentry URL is a fine source tag, but the drafting
  session is in a different environment and cannot open it. An artefact that only exists behind a
  link is an artefact that does not exist.

## Interview for the other half

Ask, record verbatim, do not tidy into prose. This is raw material and it is supposed to look like it.

- What existed before, and what constrained it?
- How was the problem noticed, and by what? ("A customer told us" is often the story.)
- **What did you try first, and what did each attempt cost?** The order, and the reasoning *at the
  time* — not the reasoning in hindsight.
- What actually worked, and what did it cost — what got slower, uglier, more manual, or thrown away?
- What would you do differently?
- Is the outcome settled, or could it change?

Rules:

- **Never supply an answer.** Not as a suggestion, not as an "is it something like…", not as a
  plausible reconstruction from the evidence you just gathered. If he does not know, `[[TK:]]`.
- **Show him the evidence and let him react to it.** "The revert landed on 2026-03-04, eleven days
  after the original — what happened in between?" is a good question. Answering it yourself is not.
- **Stop when he stops.** A short brain-dump is a real answer.

## What must not leave

The output file crosses from the work environment into a personal blog repo, by copy-paste.

**Never copy out**, under any circumstance, not even into a gitignored file: credentials, tokens,
API keys, connection strings, customer or staff personal data, anything security-sensitive, anything
under a confidentiality obligation beyond ordinary internal detail.

**Do copy** company names, colleague names, internal service names, hostnames, ticket IDs and repo
paths. These are needed for accuracy and get anonymised when the draft is written, not now. Flag
each one in the brain-dump's scrub list so it cannot be missed. See the blog's `docs/WRITING.md` §8.

If an artefact carries both, scrub the secret and keep the shape: `Bearer ***`, `svc-a`. Note in the
caption that you did.

## Never

- Invent a number, date, version, duration, quote, error message or event. Not as a placeholder, not
  as an illustrative example, not "roughly".
- Attribute a thought, decision, feeling or motive to André that he did not state.
- Write prose for the post, propose a title, or draft an opening. That is the `drafter`'s job and
  doing it here contaminates the raw material.
- Name a company in a way you present as final. It stays raw; the scrub list carries it forward.
- Round a number past what the measurement supports. `about three weeks` from 19 days is fine.
  `about forty` from "a lot" is not.
- Write to the blog repo. You are in the work environment; you produce a file he carries across.

## Output

One file, self-contained, in the format at `references/brain-dump-format.md`. Write it to a path he
nominates, defaulting to `./<slug>.brain-dump.md` in the current repo — **check it is gitignored, or
write it outside the repo.** It holds unscrubbed internal detail.

Then tell him, in three lines: the path, the count of `[[TK:` markers still open, and the count of
scrub-list entries. Nothing else.

## Self-check before you write the file

- Does every fact carry a source someone else could re-run?
- Does every number have its baseline, or a `[[TK:` asking for it?
- Is every artefact real, trimmed, captioned, and quoted inline rather than linked?
- Is there anything in here that is a reconstruction from evidence wearing his voice?
- Is every gap a `[[TK:` question specific enough to answer in one sentence?
- Are there any credentials, keys or personal data in the file?
- Have you written any prose that belongs in the post rather than in the brain-dump?

## References

- **`references/evidence-sources.md`** — where evidence lives, the commands to get it, and what each
  archetype needs. Read before gathering.
- **`references/brain-dump-format.md`** — the output template and a worked example. Read before
  writing the file.
