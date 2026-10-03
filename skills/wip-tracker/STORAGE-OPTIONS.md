# Offline continuity storage choice

**Keep SQLite for C1/C2.** The store is one private local file, written by short trusted transactions. Event identity, handoff acceptance, feedback claim and deletion must commit atomically. SQLite provides those semantics and concurrent access from separate local connections without a database service. This is a storage choice, not approval to initialize a live store or wire roles. The TypeScript implementation uses Node 22's built-in `node:sqlite`; [Node marks that API experimental](https://nodejs.org/download/release/latest-jod/docs/api/sqlite.html), so its version/driver is a separate activation decision.

| Option | Fit for this pilot | Reason to revisit |
| --- | --- | --- |
| **SQLite** | Best current fit: local file, transactional writes, no server. | If the record becomes a network-shared, multi-host service. [SQLite's own guidance](https://www.sqlite.org/whentouse.html) recommends a client/server database for that case. |
| [PGlite](https://pglite.dev/docs/about) | Embedded Postgres in TypeScript with filesystem persistence. | Useful if Postgres compatibility or extensions become central. Its [socket layer](https://pglite.dev/docs/pglite-socket) multiplexes a single connection and says not all multi-connection cases are covered; that adds uncertainty to competing local writers. |
| [PostgreSQL server](https://www.postgresql.org/docs/current/tutorial-arch.html) | Strong fit for a shared service with many clients. | Adds a managed server, credentials and lifecycle for a private local pilot that does not need them. |
| [DuckDB](https://duckdb.org/docs/current/connect/concurrency) | Good candidate for later analysis of exported records. | Its in-process read/write mode uses one writer process; the continuity collector needs competing local processes to arbitrate writes. |
| Append-only JSON files | Simple to inspect and copy. | We would have to build and verify transaction, uniqueness, concurrency, backup and deletion-ledger behavior ourselves; it has no advantage for this scope. |

Keep the database behind the `Store` API. A future move would need an explicit schema and data migration, replay/concurrency tests on the replacement, and revised backup/deletion guarantees. This PR performs no migration.
