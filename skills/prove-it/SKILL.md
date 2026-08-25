---
name: prove-it
description: Pick the cheapest validation surface that could actually FALSIFY a claim, then run it — instead of accepting "it should work" or a green check that cannot fail. Covers the Rock of Eye ladder: static checks, Pest/Vitest, local E2E, `make doctor`, cloud preview boxes, staging, CI workflows, and post-deploy production verification. Use when André says "prove it", "are you sure", "did that actually work", "how do we validate this", "how do I test this", "verify that", "is it really fixed", "show me", "what would catch this", or before claiming any change is done, shipped, or safe. Also use when deciding whether a change needs a preview box or staging at all, and when a passing test looks too easy.
---

# Prove It

André approves roughly twice as often as he asks for verification, across work
that routinely touches production. This skill is the counterweight: it turns
"it should work" into a specific surface, a specific command, and a result that
could have come out the other way.

**The governing rule: a check that cannot fail has proved nothing.** Before
trusting any green, be able to say what red would have looked like.

## Step 1 — State the claim, precisely

Write the claim as something falsifiable before choosing a tool. Not "the fix
works" but "a Clothier in tenant A can no longer read tenant B's orders" or
"the labour form renders sleeve length in cm for tenant X".

Then ask the question that picks the surface: **what is the cheapest thing that
would come out RED if this claim were false?**

## Step 2 — Climb only as high as the claim needs

Stop at the first rung that can actually falsify it. Going higher is slower and
usually proves *less*, because higher rungs have more ways to pass by accident.

| Rung | Command | Proves | Cannot prove |
|---|---|---|---|
| **Static** | `./vendor/bin/pint --test`, `phpstan analyse` | Style, types, obvious breakage | Any runtime behaviour |
| **Unit** | `make exec-api ARGS="php vendor/bin/pest tests/Unit"` | Pure logic, calculations | Anything touching DB/HTTP |
| **Feature** | `make exec-api ARGS="php vendor/bin/pest Modules/<M>/Tests/Feature/<T>.php"` | Route + middleware + Action + DB | Cross-service, browser, real data shape |
| **Frontend unit** | `make exec-client ARGS="yarn test"` (aio/partner too) | Store, service, component logic | The API contract on the other side |
| **Local E2E** | `make test-e2e` (needs `make port-forward`) | Full journey against seeded local data | Real tenant data, prod config, infra |
| **Env health** | `make doctor` (`STRICT=1` fails on warnings) | The local stack is actually wired | Your change |
| **Preview box** | `make preview-up PR=<n>` → `preview-seed` → `preview-test` | The branch on real cloud infra, isolated | Prod data volume/shape |
| **Staging** | Actions ▸ "Deploy … to staging" (dispatch, `ref` blank) | Deployed artifact, real infra, migrations | Prod's tenant set (see trap below) |
| **Production** | `/up` version check + targeted read-only probe | It is genuinely live and serving | — |

Cross-cutting: **CI** proves the gate passed —
`gh pr checks <n>`, `gh run list --workflow <f>`, `gh run view <id> --log-failed`.

## Step 3 — Falsify your own green

Every one of these has produced a confident false pass in this codebase:

- **Can the test fail?** Mutate the thing under test — break the assertion's
  subject on purpose and re-run. If it still passes, the fixture never reached
  the surface. A no-op mutation reads exactly like a passing suite.
- **`Mail::fake()` / `Queue::fake()` hide transport bugs.** A test asserting a
  mail was "sent" against a fake proves the call site, never the transport.
  Queue assertions on `AsTenantJob` need the decorator or they always pass.
- **`DatabaseTransactions` masks post-commit behaviour**, and local MySQL runs
  with `FOREIGN_KEY_CHECKS=0` — FK tests can pass for the wrong reason.
- **Cache-invalidation tests cannot fail under the array store.** Assert
  `Cache::has()` explicitly.
- **Pest locally targets the dev DB; SSO tests hit the live local DB.** Naming a
  real tenant in a test *writes to it*.
- **A baselined gate's green decays.** PHPStan/lint baselines drift — re-run
  immediately before merging, not once at the start.
- **Read `outcome`, not `conclusion`** on GitHub Actions steps, and remember a
  missing secret resolves to empty string rather than failing.
- **Empty output is not a zero result.** `docker exec` can return before the
  command ran. Sentinel your matchers; poll, don't read once.

## Step 4 — Know what each environment structurally cannot tell you

- **Preview `up` reports ready before it is usable.** A green boot is not a
  working box — hit it (`make preview-open PR=<n>`) before trusting it. Its
  default preset is **empty**; seed it (`--preset personas` / `make preview-seed`)
  or your assertions test nothing.
- **Staging is not a tenant census.** Its tenant set differs from prod — any
  claim shaped "N tenants have X" requires a prod read, full stop. Staging also
  carries some production *values*, so treat its data as sensitive.
- **Staging's api sits behind CloudFront; prod's does not.** CloudFront 403s a
  GET-with-body, so a request shape can pass prod and fail staging (or vice
  versa) for reasons unrelated to your change.
- **The staging E2E tenant has almost no order data** — one swatch order. A
  journey needing orders will pass vacuously there.
- **E2E specs must declare their `suite`.** An undeclared spec defaults to the
  production-data suite.
- **Never wait on `networkidle`** in the portals — it is unreachable, not merely
  flaky.
- **Tenant-scoped artisan needs an in-script connection switch**; `DB_DATABASE=`
  on the command line is ignored.

## Step 5 — Report it honestly

Say the surface, the command, and the actual result. Distinguish three states
and never blur them:

- **Verified** — "ran X, got Y" (quote the output).
- **Unverified** — could not check; say so and say why.
- **Cannot be proven here** — the surface structurally can't answer it; name the
  surface that could.

If the check was skipped, say it was skipped. A hedge-free "done" is only
allowed after a check that could have failed and didn't.
