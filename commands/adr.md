# ADR

Scaffold a new Architecture Decision Record (ADR) following the standard format.

## Instructions

1. Ask for (or infer from context) the decision topic
2. Generate a new ADR file following the structure below
3. Suggest the next sequential filename based on today's date — format: `YYYY-MM-DD-N-<slug>.md`
4. Place it in `docs/architecture-decision-records/`

## Output format

```markdown
# ADR-<YYYY-MM-DD-N>: <Decision Title>

- **Status:** Draft
- **Date:** <today's date>
- **Decision Makers:** [name(s)]
- **Context Documents:** [links to relevant analysis docs, if any]

---

## Executive Summary

> Non-technical summary for leadership and stakeholders.

[2-3 sentence plain-English description of what decision was made and why it matters.]

---

## Context

### Problem Statement

[What problem or need prompted this decision? Be specific about the impact if unaddressed.]

### Current State

[What is the current situation? What pain points exist?]

### Constraints

[What constraints apply? Budget, timeline, team skill set, existing dependencies, etc.]

---

## Options Considered

### Option A: [Name]

**Description:** [What this option involves]

**Pros:**
- 

**Cons:**
- 

**Cost/effort:** [Rough estimate]

### Option B: [Name]

**Description:**

**Pros:**
- 

**Cons:**
- 

**Cost/effort:**

---

## Decision

**We will [do X].**

[1-2 paragraphs explaining why this option was chosen over the alternatives.]

---

## Consequences

### Positive
- 

### Negative / Trade-offs
- 

### Risks
- 

---

## Implementation Notes

[Key technical details, steps required to implement, or constraints on how the decision is executed.]

---

## Review

This ADR should be reviewed if: [conditions that would prompt revisiting this decision]
```

## Notes

- Be concise in the executive summary — it is read by non-technical stakeholders
- Always capture the options that were *not* chosen and why — this is the main value of an ADR
- If the decision touches an existing ADR topic, reference it
- Update the status from Draft → Approved once the decision is confirmed by the CTO
