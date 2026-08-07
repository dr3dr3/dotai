# Message shapes

Six archetypes covering most of what gets sent. Each is a **shape** — what goes in which
slot, and what to cut — not a template to fill in. Adapt freely; the slots matter more
than the wording.

Examples below are shown in code fences **so the literal characters are visible**. The
real output is never fenced — it goes in the response body between two rule lines.

Every example ends with the standard footer: labelled bare-URL references, then the action
verdict. The verdict is mandatory on every draft; references appear whenever tracked work
is involved. See SKILL.md section 2.

---

## 1. The ask

Someone has information, access, or a file you need.

**Slots:** what you need → why it is needed (one line, only if it changes their answer) →
when → what you have already done so they do not repeat it.

**Cut:** the apology, the backstory, the explanation of your project.

Executive:

```
Need the Q3 fabric supplier list to finish the costing model.

• Holland & Sherry and Dugdale are already in — missing the other four
• Blocking the pricing review on Sept 12

Can you send it, or point me at whoever owns it? Anything by Friday works.

Ticket: https://linear.app/rock-of-eye/issue/ENG-2410
Over to you — the list, or a name, by Friday.
```

Technical:

```
Need read access to the prod CloudWatch log group rock-of-eye-sso-prod.

• Chasing the 500s on /auth/callback from Tuesday night
• I have staging access already, and staging doesn't reproduce it
• DeveloperAccess doesn't include it — needs an explicit grant

Can you add it, or tell me if there's a reason not to? Not urgent, this week is fine.

Ticket: https://linear.app/rock-of-eye/issue/ENG-2446
Over to you — grant or a reason not to, this week.
```

---

## 2. Status update

**Slots:** headline verdict (on track / at risk / slipped) → what moved → what is blocked
and who owns unblocking it → what is next.

**Cut:** everything that happened but changed nothing. A list of activity is not a status
update.

Never send a third consecutive amber with no change — say what would actually turn it
green.

```
Showroom permissions are live in prod as of this morning. On track.

• Rolled out to Wil Valor first — no errors in 24 hours
• Remaining tenants go out with next week's release
• Blocked on nothing

Ticket: https://linear.app/rock-of-eye/issue/ENG-2269
Change: https://github.com/rock-of-eye/rock-of-eye-api/pull/1128
No action needed. Next update Friday unless something changes.
```

---

## 3. Bad news

**Slots:** what broke, plainly → who is affected and how → what is being done right now →
when the next update lands.

**Cut:** the hedging, the passive voice, the buried lede. Say it in the first line.

Name a next-update time even when you have no answer yet. It is the thing that stops
people asking.

```
Client-facing payment confirmations have been failing since 09:40. Roughly 40 clients affected.

• Cause is a queue worker that stopped picking up jobs after the deploy
• Payments themselves went through — only the confirmation emails are missing
• Worker restarted at 11:15, backlog is draining now
• We'll resend the missed confirmations this afternoon

Ticket: https://linear.app/rock-of-eye/issue/ENG-2453
No action needed. Next update by 3pm, or sooner if the backlog clears.
```

---

## 4. Decision request

**Slots:** the decision to be made, in one line → the options, one clause of trade-off
each → your recommendation → who decides and by when.

**Cut:** the neutral survey. Recommending nothing pushes the work back onto them.

```
Need a call on how we handle the Laravel 10 upgrade.

• Option A — upgrade in place over two sprints. Lower risk, delays the pricing work by a month.
• Option B — upgrade alongside the pricing work. Ships both on time, more chance of a bad week.
• Option C — defer to Q1. No delivery impact now, and we stay on an unsupported version.

I'd go with A. The pricing work slipping a month is recoverable; a bad week in prod isn't.

Ticket: https://linear.app/rock-of-eye/issue/ENG-2411
Your call — a decision by Thursday so I can plan the sprint. No reply by then and I'll take A.
```

---

## 5. Announcement / change notice

**Slots:** what changed → who is affected → what they have to do (or "nothing") → where
to go with problems.

**Cut:** the rationale, unless it changes what they do. Link it instead.

The most common failure is not telling people they need to do nothing. Say it.

```
Deploys to production now go out by tag, not by branch push.

• Affects anyone shipping to prod — staging is unchanged
• You don't need to do anything differently: PR to master as usual
• Ping André when something is ready and he cuts the release tag

Guide: https://github.com/rock-of-eye/local-dev-env/blob/master/docs/guides/developer/delivery-workflow.md
Decision: https://linear.app/rock-of-eye/document/adr-2026-05-24-1
No action needed. Questions to me.
```

---

## 6. Nudge / follow-up

**Slots:** restate the ask in one line → restate the deadline → offer an out.

**Cut:** the guilt, the apology, the "just following up on my last message", the whole
original message pasted again.

Keep it to three lines. A nudge longer than the original ask reads as pressure.

**The one footer exception.** The references already went out with the original ask —
repeating them makes the nudge longer than the thing it is nudging. Links only if the
original was in a different channel or has scrolled away. The action verdict stays; here
it is the whole message.

```
Still need the Q3 supplier list — pricing review is Friday.

If it's easier, send me whatever you have and I'll work with it.
```

---

## Choosing a shape

| Situation | Shape |
|---|---|
| You need something from them | 1. The ask |
| They asked how it's going | 2. Status update |
| Something is broken or late | 3. Bad news |
| You need them to choose | 4. Decision request |
| They need to know, not act | 5. Announcement |
| You already asked | 6. Nudge |

If a message needs two shapes, it is two messages. The most common version of this is an
announcement with an ask buried in it — split them, and the ask actually gets done.
