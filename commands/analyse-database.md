Analyse the database schema across the RoE backend repositories.

Produce `docs/analysis/technical/05-database-schema.md` covering:

1. **Migration Inventory**: List all migrations across rock-of-eye-api, rock-of-eye-pms-core, and rock-of-eye-sso
2. **Key Tables**: For each major table, document columns, types, indexes, and foreign keys
3. **Relationships**: Map out the entity relationships (text-based ERD)
4. **Multi-Tenancy**: How tenant isolation is implemented at the database level
5. **Shared vs Module Tables**: Which tables are shared across modules vs module-specific
6. **Seeders**: What seed data exists and what it tells us about the data model
7. **Observations**: Schema design patterns, potential issues, normalisation concerns

Read CLAUDE.md first for project context. Focus on migrations in `Modules/*/Database/Migrations/` and `database/migrations/`.
