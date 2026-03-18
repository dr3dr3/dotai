Perform a security and authentication review of the RoE platform.

Produce `docs/analysis/technical/10-security-auth-review.md` covering:

1. **Authentication**: Sanctum configuration, token types, session handling, SSO token flow
2. **Authorization**: Roles and permissions system, policies, gates, middleware guards
3. **API Security**: Rate limiting, CORS config, input validation patterns, middleware stack
4. **Data Protection**: Encryption at rest, sensitive data handling, PII storage
5. **Payment Security**: How payment data is handled (PCI compliance considerations)
6. **Dependency Security**: Check composer.lock and package-lock.json for known vulnerable packages
7. **Configuration Security**: Review .env.example files for sensitive defaults, debug modes
8. **Recommendations**: Prioritised list of security improvements

Read CLAUDE.md first for project context. Be thorough - this is a critical analysis for a new CTO.
