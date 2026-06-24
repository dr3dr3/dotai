# Standing context

Persistent grounding that autonomous agents (e.g. [Idea Wrangler](../agents/idea-wrangler/))
load **before reasoning**, so they don't re-litigate settled questions or propose things
we've already decided against.

These files are **yours to keep current** — they're the single source of truth an agent
trusts. Treat them like product memory: short, blunt, and up to date.

| File | What it's for | Keep current when… |
|------|---------------|--------------------|
| [strategy.md](strategy.md) | Where Rock of Eye is going and why | strategy shifts, a new bet is made |
| [non-goals.md](non-goals.md) | What we are explicitly **not** doing | you reject an idea, set a boundary |
| [roadmap.md](roadmap.md) | Recent decisions + what's in flight | something ships, a decision is made |

> **These start as placeholders.** Fill them in before relying on agent output — an agent
> grounded on empty/te stale context will reason from thin air and flag low confidence.

Agents read **all three** at startup and weigh them as `[docs]`-sourced, high-confidence
grounding. If a file is empty, the agent says so in its output rather than guessing.
