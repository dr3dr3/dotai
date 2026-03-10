````markdown
# Generate Tests

Generate tests for a given class, function, endpoint, or business flow, following the project's testing conventions.

## Instructions

To use this command, provide one of:
- The source code of a class or function to unit test
- An API route + expected behaviour to integration/feature test
- A business flow (e.g., "payment processing", "data isolation for tenant A vs tenant B") to test end-to-end

Then generate tests following the guidelines below.

---

## Test generation guidelines

### Which framework to use

Refer to `context/testing-philosophy.md` for the current test framework and tooling.

[FILL IN: If you have multiple services using different test frameworks, list them here:]

| Service / Repo | Framework | Example syntax |
|----------------|-----------|----------------|
| `[service-a]` | [e.g. Pest, pytest, Jest, RSpec] | [e.g. `it('...', fn() => ...)`] |
| `[service-b]` | [e.g. PHPUnit, unittest, Vitest] | [e.g. `def test_...():` ] |

### Where to place the file

[FILL IN: Where should test files live? Examples:]

```
# Co-located:
src/
  [module]/
    [feature].ts
    [feature].test.ts

# Mirrored:
tests/
  unit/
    [module]/
  integration/
    [module]/
```

### Unit test pattern

[FILL IN: Replace this example with a representative unit test from your actual codebase]

```[language]
// Example shape — replace with your actual framework and conventions

describe('[ClassName or function]', () => {
  it('[does the expected behaviour]', () => {
    // Arrange
    const input = [test input];

    // Act
    const result = [function under test](input);

    // Assert
    expect(result).toEqual([expected output]);
  });

  it('throws when [invalid condition]', () => {
    expect(() => [function under test](invalidInput)).toThrow([ErrorClass]);
  });
});
```

### Integration / feature test pattern

[FILL IN: Replace this example with a representative integration/API test from your codebase]

```[language]
// Example shape — replace with your actual framework and conventions

describe('[endpoint or flow]', () => {
  it('[authenticated user can do X]', async () => {
    // Arrange
    const user = await createTestUser({ role: '[role]' });

    // Act
    const response = await request(app)
      .post('[/api/endpoint]')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ [field]: [value] });

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.data.[field]).toBe([expected]);
  });

  it('rejects unauthenticated requests', async () => {
    const response = await request(app).post('[/api/endpoint]').send({});
    expect(response.status).toBe(401);
  });
});
```

### Mocking external services

Always mock third-party API calls. Never make real HTTP requests in tests.

[FILL IN: Replace with the mocking approach your stack uses]

```[language]
// Example: intercept HTTP calls (e.g. with MSW, WireMock, Http::fake(), responses.activate)
[mock setup code]

// Then run the code under test
const result = await [functionUnderTest]([args]);
expect(result.[field]).toBe([expected]);
```

---

## Coverage priorities

When deciding what to test, prioritise in this order:

1. **Data isolation / access control** — Can user A access user B's data? Must be NO.
2. **Money and payments** — Charge, refund, and reconciliation paths
3. **Business state transitions** — Only valid sequences should be allowed
4. **Calculations with conditionals** — Pricing, discounts, commissions
5. **Auth** — Unauthenticated and unauthorised rejections
6. **Any function with a meaningful conditional branch**

---

## What to avoid generating

- Tests for trivial getters/setters with no logic
- Tests for framework or library internals
- Tests that only assert response structure without checking behaviour
- Tests that make real calls to external services

````
