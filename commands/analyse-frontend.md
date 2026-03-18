Analyse one of the RoE frontend portals.

Usage: Specify which portal - "all-in-one", "client", or "partner"

For the specified portal, produce detailed analysis covering:

1. **Route Inventory**: List all routes/pages from the router config
2. **State Management**: Document all Vuex ORM models (or Pinia ORM for client portal) - fields, relationships, API endpoints
3. **API Layer**: How the frontend communicates with the backend (Axios config, base URLs, interceptors, auth headers)
4. **Page Breakdown**: For each major page/feature area, describe what it does and which components it uses
5. **Shared Components**: Notable reusable components
6. **Configuration**: Quasar config, environment variables, build setup
7. **Observations**: Code patterns, inconsistencies, technical debt

Write output to the appropriate docs file (06 for All-in-One, 07 for Client Portal, 08 for Partner Portal) in the folder /doc/analysis/technical/.

Read CLAUDE.md first for project context.
