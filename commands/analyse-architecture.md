Analyse the overall architecture of the RoE platform across all 6 repositories.

Produce `docs/analysis/technical/architecture-overview.md` covering:

1. **System Architecture**: How the 6 repos relate. Draw a text-based diagram showing the relationships between API, PMS-Core, SSO, and the 3 frontend portals.
2. **Authentication Flow**: Trace the SSO flow - how a user authenticates and how tokens are shared across services.
3. **Multi-Tenancy**: How tenants (tailoring businesses) are isolated. Check for tenant_id patterns, middleware, database scoping.
4. **Data Flow**: How data moves between services. Check for shared databases vs API-to-API calls.
5. **Deployment**: Look for Docker files, CI/CD configs, environment files to understand deployment topology.

Read the CLAUDE.md file first for project context. Be thorough - read config files, middleware, route files, and service providers across all backend repos.
