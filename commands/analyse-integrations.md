Analyse all third-party integrations across the RoE platform.

Produce `docs/analysis/technical/09-third-party-integrations.md` covering each integration:

For each external service (Stripe, Adyen, SecurePay, Airwallex, Xero, Zoho, EngageBay, Twilio, OpenAI, Sentry, AWS S3):

1. **Which repos/modules use it**: Where is the integration code?
2. **Configuration**: How is it configured? (env vars, config files, service providers)
3. **Implementation**: Key classes, API calls, webhook handlers
4. **Data Flow**: What data is sent/received
5. **Error Handling**: How failures are handled

Also check for any integrations not listed above that may exist in the codebase.

Read CLAUDE.md first for project context.
