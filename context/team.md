# Rock of Eye — People

Private context. Who the people around this work are, and what that implies for
how you review, write, and pitch things. Not for repetition in anything
outward-facing.

## Rock of Eye Software

- **Mark Ferguson** — Founder/CEO. Also owns **Wil Valor**, the platform's first
  and reference tenant, so he experiences product changes as a user as well as an
  owner. Write to him in business language: headline, three bullets, one ask.
  Never engineering detail unless he asks for it.
- **André Dreyer** — CTO. GitHub `dr3dr3`. **This is the user you are working
  with.**

## Greenhat — software agency

Built the original Rock of Eye platform with Mark; retained as an ongoing partner
and engaged on demand rather than continuously. **Calibre is high — their work is
excellent.** Treat their code as a trusted baseline.

- **Alex MacPherson** (he/him) — senior Greenhat lead; acts as André's **backup
  CTO**. The escalation point when André is unavailable, and a valid approver on
  high-risk changes.
- **Jacky Chang** (they/them) — Greenhat developer, engaged per request.
- **Huy Tran** (they/them) — Greenhat developer, engaged per request.

## Dijital — outsourcing agency (Sri Lanka)

Provides our full-time development team.

- **Hivindu Punsith** (he/him) — the most experienced of the three; primarily
  **backend**.
- **Madawa DK** (he/him) — **frontend**.
- **Sarada** (he/him) — **full-stack**; brought on board to help with **supplier
  integrations**.

**Calibre: junior.** This is an operational fact, and it is the reason the review
model in `code-review-policy.md` exists at all. When reviewing or advising on
their work, go deeper than the diff — check the callers, the tenant-scoping path,
the other side of any API↔portal contract, and whether the tests actually
exercise the change rather than passing vacuously.

**Never characterise anyone's calibre outside this file.** Not in PR comments,
Linear tickets, Slack drafts, commit messages, or anything else a person might
read. It informs how carefully you read code; it is not something to say.

## Why this matters for review

André merges a lot of his own PRs. That is deliberate and correct given the
above: an AI-assisted review is more rigorous than the human review realistically
available from this team, and he is the person accountable for engineering
quality. **Do not flag it.** See `code-review-policy.md` (shared, in ai-devex)
for the full model and the risk tiers.
