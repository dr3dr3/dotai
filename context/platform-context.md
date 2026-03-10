# Platform Context

## External Integrations

[FILL IN: What third-party services does this platform integrate with? List them below by category.]

### Payments

| Service | Purpose | Notes |
|---------|---------|-------|
| [e.g. Stripe] | [e.g. Card payments, subscriptions] | [e.g. Use Stripe SDK v12+; never log card data] |
| [e.g. PayPal] | [e.g. Checkout alternative] | [any gotchas] |

### Communications

| Service | Purpose | Notes |
|---------|---------|-------|
| [e.g. SendGrid / AWS SES] | [e.g. Transactional email] | [e.g. Use queued jobs for all outbound email] |
| [e.g. Twilio] | [e.g. SMS notifications] | [any rate limits or opt-out handling] |

### Identity / Auth

| Service | Purpose | Notes |
|---------|---------|-------|
| [e.g. Auth0 / Cognito / Clerk] | [e.g. SSO, user management] | [e.g. JWTs validated at API gateway] |

### Storage / Infrastructure

| Service | Purpose | Notes |
|---------|---------|-------|
| [e.g. AWS S3 / GCS] | [e.g. File uploads, media] | [e.g. Signed URLs for all private assets] |
| [e.g. Redis] | [e.g. Cache, queues, sessions] | [any eviction policy notes] |
| [e.g. CloudFront / CDN] | [e.g. Static asset delivery] | [cache invalidation strategy] |

### External APIs / Data

| Service | Purpose | Notes |
|---------|---------|-------|
| [e.g. OpenAI] | [e.g. AI features] | [e.g. Rate-limit all calls; never send PII to external AI] |
| [e.g. Xero / QuickBooks] | [e.g. Accounting sync] | [e.g. Webhook-driven, not polling] |

[FILL IN: Add or remove categories as needed. Delete tables with no integrations.]

---

## CI / CD

[FILL IN: How is code built, tested, and deployed?]

- **CI platform:** [e.g. GitHub Actions, CircleCI, Buildkite]
- **CD platform:** [e.g. AWS CodeDeploy, Heroku, Render, Kubernetes]
- **Deployment trigger:** [e.g. Merge to `main` auto-deploys to staging; tags deploy to production]
- **Environment promotion:** [e.g. dev → staging → production]

---

## Observability

[FILL IN: How is the system monitored?]

- **Logging:** [e.g. Datadog, CloudWatch, Papertrail — structured JSON]
- **Error tracking:** [e.g. Sentry, Rollbar — all uncaught exceptions routed here]
- **Metrics / APM:** [e.g. Datadog APM, New Relic, none]
- **Alerting:** [e.g. PagerDuty for P1, Slack for P2/P3]

---

## Architecture Decision Records (ADRs)

[FILL IN: Link to your ADR log if you have one, e.g. `docs/decisions/` or Notion/Confluence link.]

Key past decisions worth being aware of:

- **[ADR topic]:** [One-line summary of the decision and why]
- **[ADR topic]:** [One-line summary]

---

## Known Constraints / Gotchas

[FILL IN: What should Claude (and any new engineer) know to avoid footguns?]

- [e.g. "Service X has a 10-second timeout — don't make synchronous calls to it from web requests"]
- [e.g. "The legacy `orders` table has no foreign key constraints — enforce integrity in code"]
- [e.g. "Feature Y is behind a flag in production but always-on in tests — don't assume flag state"]
