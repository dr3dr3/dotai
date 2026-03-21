Analyse a specific module in one of the RoE backend repositories.

Usage: Specify the repo and module name, e.g. "analyse the Order module in rock-of-eye-api"

For the specified module, produce detailed analysis covering:

1. **Purpose**: What this module is responsible for
2. **Models/Entities**: List all models, their key fields, and relationships (belongsTo, hasMany, etc.)
3. **Routes**: List all API routes with HTTP method, URI, controller, and middleware
4. **Controllers**: Summarise each controller's actions
5. **Business Logic**: Document any Actions, Services, Jobs, Events, Listeners
6. **Database**: List migrations and describe the schema
7. **External Dependencies**: Any third-party API calls or package usage
8. **Observations**: Anything notable - patterns, complexity, potential issues

Write the output to the appropriate docs file (backend-api for API modules, backend-pms-core for PMS-Core, backend-sso for SSO) in the folder /docs/analysis/technical/. Append to the file if it already exists.

Read CLAUDE.md first for project context.
