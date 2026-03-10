# Domain Language

## Why This Matters

Claude writes code using your team's vocabulary. If your domain has specific terms — actors, objects, business concepts — define them here. This prevents Claude from substituting generic synonyms that create inconsistency across the codebase.

---

## Core Actors

[FILL IN: Who are the humans or organisations that interact with your system?]

| Term | Meaning | Notes / Do Not Confuse With |
|------|---------|----------------------------|
| `[Actor A]` | [What this person/org is and what they do] | [common confusion] |
| `[Actor B]` | [What this person/org is and what they do] | [common confusion] |
| `[Actor C]` | [What this person/org is and what they do] | [common confusion] |

---

## Key Concepts / Objects

[FILL IN: What are the central domain objects or business concepts that appear in code?]

| Term | Meaning | Notes / Do Not Confuse With |
|------|---------|----------------------------|
| `[ConceptA]` | [Plain-English definition] | [common wrong assumption] |
| `[ConceptB]` | [Plain-English definition] | [common wrong assumption] |
| `[ConceptC]` | [Plain-English definition] | [common wrong assumption] |

---

## Variable and Code Naming

[FILL IN: What naming conventions do you use for domain terms in code? Examples:]

| Concept | Database column | PHP/Python/JS variable | Notes |
|---------|----------------|------------------------|-------|
| [Concept A] | `concept_a_id` | `conceptAId` | [any edge cases] |
| [Concept B] | `concept_b` | `conceptB` | [any edge cases] |

[FILL IN: Delete the table above and replace with a format that fits your stack — Ruby, TypeScript, Go, etc.]

---

## Common Terminology Mistakes

[FILL IN: What wrong terms does Claude (or new team members) tend to use?]

| Wrong | Correct | Why |
|-------|---------|-----|
| [generic term] | `[your term]` | [why yours is specific/important] |
| [synonym Claude might use] | `[your term]` | [reason] |

---

## Further Reference

[FILL IN: Link to any internal glossary, data dictionary, or domain model diagram if one exists.]
