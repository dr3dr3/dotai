# Testing Philosophy

## Current State

[FILL IN: Honestly describe the current test coverage and culture. Examples:]

- [e.g. "We have strong unit test coverage on domain logic, but minimal integration tests"]
- [e.g. "The codebase has no automated tests yet — we are establishing the baseline"]
- [e.g. "E2E tests exist for critical user journeys; unit tests for all new business logic"]

---

## What to Test

[FILL IN: What should always have tests written for them?]

- [ ] [e.g. "All business logic / service layer methods"]
- [ ] [e.g. "Any code touching money, permissions, or data deletion"]
- [ ] [e.g. "Public API contracts (request/response shape)"]
- [ ] [e.g. "Edge cases: empty inputs, zero values, concurrent writes"]

## What NOT to Test

[FILL IN: What is low-value to test and should be skipped?]

- [ ] [e.g. "Framework boilerplate / generated code"]
- [ ] [e.g. "Simple getters/setters with no logic"]
- [ ] [e.g. "Third-party library internals"]

---

## Frameworks and Tools

| Layer | Tool | Notes |
|-------|------|-------|
| Unit | [e.g. Jest, pytest, PHPUnit/Pest, RSpec] | [any config notes] |
| Integration | [e.g. Supertest, Testcontainers, Laravel HTTP tests] | [scope] |
| E2E | [e.g. Playwright, Cypress, none] | [when to write these vs integration] |
| Mocking | [e.g. jest.mock, unittest.mock, Mockery] | [preferred style] |
| Fixtures / Factories | [e.g. FactoryBot, factory_boy, Laravel factories] | [location] |

---

## Writing Tests — Conventions

[FILL IN: What patterns do you follow? Examples:]

- **Structure:** [e.g. Arrange-Act-Assert / Given-When-Then]
- **Test naming:** [e.g. `it('throws when input is empty', ...)`  or  `test_raises_when_input_is_empty`]
- **File location:** [e.g. "Co-located alongside the source file" or "Mirrored under `tests/`"]
- **Avoiding flakiness:** [e.g. "Always mock time and external HTTP — never rely on real clocks or network in unit tests"]

### Example Unit Test Shape

```[language]
[FILL IN: Paste a representative unit test from your codebase here, so Claude understands style, assertion style, and factory usage.]
```

### Example Integration Test Shape

```[language]
[FILL IN: Paste a representative integration test — e.g. an API route test that hits the database.]
```

---

## Mocking External Services

[FILL IN: How do you handle third-party services in tests?]

| Service Type | Approach |
|-------------|----------|
| HTTP APIs (payments, comms, etc.) | [e.g. MSW intercepts, VCR cassettes, dedicated fake server, test doubles] |
| Queues / async jobs | [e.g. "Run synchronously in test env", "Assert on enqueued job class, not execution"] |
| Storage (S3, local disk) | [e.g. "Use in-memory / temp disk adapter in tests"] |
| Time | [e.g. "Always freeze time in tests — use `travel_to` / `jest.setSystemTime`"] |

---

## CI Behaviour

[FILL IN: How do tests run in CI?]

- **Command:** `[e.g. npm test / pytest / php artisan test]`
- **Required to pass:** [e.g. "All unit + integration tests must be green before merge"]
- **Coverage threshold:** [e.g. "No enforced threshold currently" or "80% line coverage required"]
