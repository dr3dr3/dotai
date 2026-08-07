---
name: draft-post
description: Draft a message for a human — Slack, Teams, WhatsApp, email, LinkedIn, or any chat app. Produces a paste-ready post in the chat with no markdown syntax, written BLUF, bulleted, plain English, no pleasantries. Use when the user asks to "draft a post", "write a message/update/announcement", "draft something for <person>", "write this up for the team", "how do I ask X for Y", "draft a reply to this", "put this in a Slack post", "message the team about", or wants an existing draft made shorter, clearer, less formal, or more/less technical. Defaults to an executive register; switches to a technical register when the user says technical, engineering, for the devs, or names an engineering audience. NOT for commit messages, PR descriptions, ADRs, docs, or code comments.
---

# Draft Post

Turns a rough intent into a message a human can read in fifteen seconds and reply to in
sixty. Output goes **into the chat**, already formatted for the target app, ready to
highlight and copy.

Two things make a draft good here: **the reader gets the point immediately**, and
**replying is nearly effortless**. Everything below serves one of those two.

---

## 1. Output contract — the most-violated rule, so check it last as well as first

- **Print the draft in the response body.** Never write it to a file. Never put it in a
  fenced code block. Highlight-and-copy is the workflow.
- **Fence the draft with a rule line above and below** so the copy region is unambiguous:

  ```
  ────────────────────────────────
  <the draft>
  ────────────────────────────────
  ```

  The rules are markers, not part of the message. Nothing else goes inside them.
- **Label the draft above the top rule** when the destination is not obvious, or whenever
  you produce more than one draft: `**Reply to Mark** — ENG-1769 thread`. Who it goes to,
  and where. The label is markdown (it is not being pasted) and sits outside the rules.
  Each draft gets its own label and its own pair of rules.
- **Emit the target app's native formatting, never markdown source.** Markdown syntax
  pastes as literal characters into every chat app. See `references/channels.md` for the
  per-platform table; the defaults are:
  - `•` as the literal bullet character. Never `-`, `*`, or `1.` list markers.
  - Slack and WhatsApp: `*bold*` (single asterisk), `_italic_`.
  - Teams, email, LinkedIn: **no inline emphasis markers at all.** Line breaks and
    bullets carry the structure.
  - Never `##` headings, never `**bold**`, never `|` tables, never `[text](url)`.
    Bare URLs only.
  - Backticks render as inline code in Slack and WhatsApp only, and are worth it solely
    for a literal token the reader must type or match — a branch name, a flag, a command.
    In Teams, email, and LinkedIn they paste as visible backticks: drop them there. Never
    use them for emphasis in any channel.
- **No preamble.** Do not explain what you are about to write. The rule line is the first
  thing after any clarifying question.
- **At most one line after the draft** — flag `[NEED: …]` markers, or offer an adjustment
  ("Shorter, more technical, or as an email?"). Nothing longer.

If the target app is unknown and the wording would differ, ask once, in one line. If it
would not differ, pick the plainest form and move on.

---

## 2. Structure — BLUF, every time

1. **Headline.** One line. The decision, the change, or the ask. Never context, never a
   preamble, never a greeting.
2. **Context.** Two to five bullets. Only what the reader needs to act on the ask — not
   everything you know.
3. **What I need from you.** Named person, specific action, deadline. Keep it near the
   top; never bury it under the context.
4. **What I'm supplying** (optional). The diagram, the options, the numbers.
5. **References.** Labelled links, one per line. See below.
6. **Action verdict.** The last line, always.

### The footer — references and the action verdict

Every draft that touches tracked work ends with the same two-part block. It goes directly
under the body, no blank line, so it reads as one unit.

```
Ticket: https://linear.app/rock-of-eye/issue/ENG-1769
Follow-up for the 0.5 M jacket: https://linear.app/rock-of-eye/issue/ENG-2461
Change: https://github.com/rock-of-eye/rock-of-eye-api/pull/1162
No action needed.
```

**References.** One per line, `Label: <bare URL>`.

- **Bare URLs only.** Never `[text](url)` — it does not resolve in any chat app.
- **Order by what the reader opens first.** Executive: Ticket, Follow-up, Change.
  Technical: PR, Ticket, Follow-up. They reach for different things.
- **Name the link in the reader's terms.** Say `Change:` to a non-engineer, `PR:` to an
  engineer. When two links could be confused, disambiguate in the label —
  "Follow-up for the 0.5 M jacket", not a bare "Follow-up".
- **Only include a line if the link exists.** Never emit an empty label or a placeholder
  URL. If a link *should* exist and you do not have it, write `[NEED: PR link]` so it
  cannot be pasted unnoticed.
- Include the follow-up ticket whenever you are deliberately leaving something undone.
  It is what stops the reader re-reporting it.

**Action verdict.** The final line, on every draft, with no exceptions:

- Nothing owed → `No action needed.` It lets the reader stop, and it is the single
  cheapest thing you can give them.
- Something owed → one line naming who, what, and by when.
- If that line would repeat the headline word for word, the headline already served it —
  drop the duplicate rather than saying it twice.

---

## 3. Register — executive by default

**Default to executive.** Switch to technical only when the user says so ("technical",
"for the engineers", "for IT") or names an engineering audience. When an audience is
mixed, use executive and put the technical detail in a single trailing bullet.

|  | Executive (default) | Technical (opt-in) |
|---|---|---|
| Ceiling | ~150 words, ≤6 bullets | ~250 words |
| Detail | Decision, impact, cost, timing | System names, versions, error codes, PR/ticket refs, log lines |
| Language | Plain English. Expand every acronym on first use. | House and platform terms fine — Client, Clothier, labour form, tenant, EB, SSM |
| Answers | "What does this mean for the business, and what do you need from me?" | "What broke, where, and what's the fix?" |

Technical is a licence to be **specific**, not to be long or unstructured. Every other
rule in this file applies identically to both.

**Two audiences, two drafts.** When the same news has to reach an executive and an
engineer, do not compromise on one blended register — produce both, each labelled and
rule-fenced, sharing the facts but not the altitude. The exec draft says a trouser now
costs 1.61 m and clears the minimum; the technical draft says the additive constant was
0.0154 and the multiplicative terms were always unit-neutral. Same fix, different reader.

---

## 4. Make it easy for the recipient

Work through this **before** drafting. It is what separates a clear message from a useful
one.

- **Can they answer in one word?** Turn open questions into numbered ones they can answer
  inline: "1. Yes / 2. Thursday". Three numbered questions beat one paragraph of prose.
- **Am I asking, or deciding?** For a decision, propose a recommendation they can approve
  rather than an open-ended question. Give each option one clause of trade-off. "I'd go
  with B unless you object" is far cheaper to answer than "What do you think?".
- **What am I making them go find?** Supply it. The link, the screenshot, the three
  numbers, the exact quote, the ticket ID. If they have to search for it, you have moved
  your work onto them.
- **Would a picture halve the words?** If yes, *offer to produce it* — a mermaid diagram,
  a mock-up, a screenshot, an Artifact page — rather than telling them to picture it. Say
  so in your one-line footer, not inside the draft.
- **Is the deadline stated?** Name the date and what happens without a reply.
  "If I don't hear back by Thursday I'll go with option B" is legitimate and removes the
  obligation to respond at all.
- **Am I asking the right person?** If the draft needs two different people to do two
  different things, that is usually two messages.

---

## 5. Fact discipline

**Never invent a number, date, name, owner, or status to make the draft read well.**

Missing input becomes an inline marker that survives into the draft:

```
Rollout is planned for [NEED: date].
```

It has to be impossible to paste without noticing. List every marker in the one-line
footer below the draft.

Do not soften a fact you were given, and do not upgrade a maybe into a will.

---

## 6. Do not write these

**Openers:** "Hi team", "Hi all", "Morning all", "Hope you're well", "I hope this finds
you well", "Just wanted to", "Quick one", "Sorry to bother you", "As you know".

**Closers:** "Thanks in advance", "Thanks all", "Please let me know if you have any
questions", "Happy to discuss", "Looking forward to your response", "Cheers".

**Body filler:** circle back, reach out, align on, leverage, touch base, deep dive, at
this point in time, due to the fact that, in order to, it's worth noting that, as
mentioned above, I wanted to flag that.

**Structural tells:** "Not just X — it's Y", stacked rhetorical questions, em-dash-heavy
sentences, a paragraph where a bullet works, emoji as decoration, CAPS for emphasis,
bolding half the message so nothing stands out.

Getting straight to the point is not rude. Everyone already knows each other.

---

## 7. Self-check before you print

- Headline first, and is it the actual point?
- Is the ask explicit, assigned to a named person, and dated?
- Is every bullet load-bearing? Delete any that only adds background.
- Zero markdown syntax? No `**`, `##`, `|`, `[](…)`, `-` bullets. Backticks only in
  Slack/WhatsApp, and only around a literal token.
- Within the word ceiling for the register?
- No banned openers or closers?
- Could the recipient reply in under sixty seconds without opening anything else?
- Every uncertain fact marked `[NEED: …]` rather than guessed?
- Every ticket, PR, and follow-up the reader might want, in the footer as a bare labelled
  URL — ordered for this reader, and none of them a placeholder?
- Does the last line say what they owe you, even when that is nothing?

---

## References

- **`references/channels.md`** — read before drafting when the target app is Slack, Teams,
  or WhatsApp. Per-platform paste fidelity, and the delivery traps that are already
  proven.
- **`references/shapes.md`** — read when the message is one of the six common archetypes
  (ask, status update, bad news, decision request, announcement, nudge). Worked examples
  in the exact output format.
