# System Architecture

## Overview

[FILL IN: 2-3 sentences describing your system. What does it do? Who uses it? What problem does it solve?]

---

## Repository / Service Map

| Repo / Service | Tech Stack | Role |
|----------------|-----------|------|
| `[service-name]` | [Language, Framework, key libraries] | [What this service owns] |
| `[service-name]` | [Language, Framework, key libraries] | [What this service owns] |
| `[service-name]` | [Language, Framework, key libraries] | [What this service owns] |

[FILL IN: Are these independent repos, a monorepo, or a mix? Any critical cross-repo constraints to be aware of?]

---

## System Diagram

[FILL IN: ASCII or Mermaid diagram showing how services relate, e.g. which service handles auth, which holds data, which is the public-facing API.]

```
[Example placeholder]
     +-------------+        +-------------+
     |  Frontend   | -----> |   API       |
     +-------------+        +------+------+
                                    |
                             +------v------+
                             |   Database  |
                             +-------------+
```

---

## Service Communication

| Caller | Callee | Method | Notes |
|--------|--------|--------|-------|
| [Service A] | [Service B] | [HTTP / gRPC / Queue / etc.] | [Any auth headers or contracts required] |

[FILL IN: How do services authenticate to each other? Shared secrets, service tokens, mTLS?]

---

## Authentication Flow

[FILL IN: Describe how end-users authenticate. Example outline:]

1. User logs in via [auth provider / login page]  
2. Token issued and stored [where — cookie, localStorage, service worker]  
3. Token validated by [which service, using which method]  
4. Downstream services receive [what — forwarded token, translated claims, service token]

---

## Multi-Tenancy / Data Isolation

[FILL IN: Does the platform serve multiple tenants? If yes, describe the isolation model:]

- **Isolation strategy:** [Row-level scoping / separate schemas / separate databases / none]  
- **How tenant is resolved:** [Subdomain / header / JWT claim / other]  
- **Risk of cross-tenant data leakage:** [Where are the blast radius points?]

If not multi-tenant, delete this section.

---

## Code Structure

[FILL IN: Describe the high-level folder layout and any module/domain conventions. Example:]

```
src/
  [domain-a]/      # [what lives here]
  [domain-b]/      # [what lives here]
  shared/          # [cross-cutting utilities]
```

Key modules / domains:

| Module | Location | Responsibility |
|--------|----------|----------------|
| [module] | `[path]` | [what it owns] |

---

## Local Development

[FILL IN: How do developers run the stack locally?]

| Service | URL / Port | Notes |
|---------|-----------|-------|
| [service] | `http://localhost:[port]` | [any gotchas] |

[FILL IN: Any environment variable files, seed commands, or one-time setup steps to note?]
