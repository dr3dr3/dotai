```markdown
# Code Review

Review the provided code (or the current branch diff) against the project's engineering standards.

## Instructions

Review the code for the following categories in order. For each issue found, provide:
- **Severity:** Critical / Major / Minor / Suggestion
- **Location:** File and line number
- **Issue:** What is wrong
- **Fix:** What the correct approach is

---

## Review checklist

### Architecture & patterns

- [ ] Business logic is in the correct layer (e.g. service/use-case classes, not controllers)
- [ ] Controllers/handlers are thin: validate input → delegate → return response
- [ ] New code is placed in the correct module/domain area
- [ ] [FILL IN: Any other architectural rules from `context/engineering-standards.md`]

### Multi-tenancy / Data isolation

- [ ] No hard-coded tenant or organisation IDs
- [ ] Tenant/org context always comes from the authenticated request, never from config
- [ ] [FILL IN: Any other data-isolation rules, or delete this section if not applicable]

### Security

- [ ] No credentials, tokens, or secrets in code (even in tests)
- [ ] No debug statements left in (e.g. `console.log`, `dd()`, `print_r()`, `debugger`)
- [ ] Auth/permission checks present for all protected routes or actions
- [ ] No raw SQL with unescaped user input

### Domain language

- [ ] Domain terminology from `context/domain-language.md` used correctly throughout
- [ ] No generic synonyms substituted for your domain's specific terms
- [ ] [FILL IN: Any specific terminology rules unique to your project]

### Code quality

- [ ] No empty catch blocks silently swallowing exceptions
- [ ] Long-running tasks and external calls are queued/async where appropriate
- [ ] Code formatter has been run (see `context/engineering-standards.md` for the command)
- [ ] No dead code, commented-out blocks, or unused imports
- [ ] No logic duplication that should be extracted to a shared utility

### Frontend (if applicable)

- [ ] Correct state management library used as per project standards
- [ ] Project's component library used rather than raw HTML equivalents
- [ ] API calls go through the configured HTTP client, not ad-hoc `fetch()`
- [ ] [FILL IN: Any other frontend rules, or delete this section if no frontend]

### Tests

- [ ] Tests added or updated for meaningful logic changes
- [ ] Tests cover behaviour, not implementation details
- [ ] External services are mocked, not called live
- [ ] Test fixtures/factories live in the correct location

### Architecture decisions

- [ ] If this change touches an ADR-covered area, the ADR was consulted and the implementation aligns

---

## Severity definitions

- **Critical** — Must be fixed before merging. Security risk, data isolation failure, or production-breaking bug.
- **Major** — Should be fixed before merging. Violates a core architecture principle or introduces significant debt.
- **Minor** — Should be addressed soon but not a hard merge blocker. Code style, domain terminology, missing test.
- **Suggestion** — Optional improvement. Readability, performance, better pattern available.

---

## Notes

- Always check `context/engineering-standards.md` for the full list of absolute rules
- Pay particular attention to code touching: payment processing, authentication, tenant/org data isolation
- [FILL IN: Any other project-specific review notes]
```
