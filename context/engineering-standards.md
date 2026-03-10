# Engineering Standards

## Absolute Rules

[FILL IN: What are the non-negotiable rules for this codebase? Things Claude must never violate. Examples:]

- [ ] [e.g. "Never write raw SQL — always use the ORM query builder"]
- [ ] [e.g. "Every public method must have a type signature"]
- [ ] [e.g. "All side effects must go through the service layer, never directly in controllers"]
- [ ] [e.g. "Never commit secrets or environment-specific values to source control"]

---

## Backend Conventions

[FILL IN: Language and framework your backend uses, and the patterns expected.]

**Language / Framework:** [e.g. Python / Django, Ruby / Rails, PHP / Laravel, TypeScript / NestJS]

### Patterns

[FILL IN: List the architectural patterns in use. Examples:]

- **[Pattern name]:** [Description. e.g. "Repository pattern — all DB access goes through a repository class, never directly in controllers or views"]
- **[Pattern name]:** [Description. e.g. "Service objects — single-responsibility classes that encapsulate a business operation"]
- **[Pattern name]:** [Description. e.g. "Command/Handler pattern for write operations"]

### Directory Structure

[FILL IN: Where does code live? Example:]

```
[root]/
  [domain-module]/
    [Models or Entities]
    [Services or UseCases]
    [Controllers or Handlers]
    [Tests]
```

### Conventions

- [e.g. "Class names are PascalCase, functions are camelCase"]
- [e.g. "Use dependency injection — never instantiate services directly in a controller"]
- [e.g. "Validation happens at the request/input boundary, not in service classes"]

### Code Style / Linting

- **Formatter:** [e.g. `prettier`, `black`, `gofmt`, `./vendor/bin/pint`]
- **Linter:** [e.g. `eslint`, `pylint`, `phpstan`]
- **Run before committing:** `[command]`

---

## Frontend Conventions

[FILL IN: Delete this section if your project has no frontend, or replace with relevant detail.]

**Framework:** [e.g. React, Vue 3, Svelte, HTMX]

- **State management:** [e.g. Zustand, Pinia, Redux Toolkit, none]
- **Component library:** [e.g. Shadcn/ui, Tailwind UI, Quasar, Ant Design, none]
- **Routing:** [e.g. React Router, Vue Router, Next.js file-based]
- **Strong preference:** [e.g. "Prefer composables/hooks over mixins", "Co-locate component styles"]

---

## Shared / Cross-Cutting Conventions

- **Error handling:** [e.g. "Use Result types, never throw from service layer", "Always log with context"]
- **Logging:** [e.g. "Use structured JSON logging. Include request ID in all log entries."]
- **Configuration:** [e.g. "All runtime config via environment variables. No hard-coded URLs or keys."]
- **Feature flags:** [e.g. "Use [your flag system] — never ship dead code behind `if false`"]

---

## Authorization / Access Control

[FILL IN: How is authorization implemented?]

- **Model:** [e.g. RBAC, ABAC, scopes, policy classes]
- **Library / mechanism:** [e.g. Pundit, Casbin, custom middleware, OPA]
- **Rule:** [e.g. "All controller actions must have an explicit permission check — no implicit allow"]

---

## Migrations / Schema Changes

[FILL IN: What are the rules around database changes?]

- [e.g. "Migrations must be backwards compatible — deploy code before dropping columns"]
- [e.g. "Never edit a migration that has been merged to main"]
- [e.g. "Large table backfills go in a separate background job, not the migration itself"]
