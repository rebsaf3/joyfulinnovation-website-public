# Migrations (stub)

Today, schema creation and “migrations” are handled inline in `src/db.js` via `CREATE TABLE IF NOT EXISTS` and a few ad-hoc `ALTER TABLE` checks.

As the product grows (Owner Portal, RBAC, impersonation, metering), move to a real migration workflow:
- store ordered migration files here (SQL or JS)
- store an applied-migrations table in SQLite
- run migrations at boot in a deterministic, testable way

Suggested approach (SQLite-friendly):
1. Create a `schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT)` table.
2. Apply migrations in lexical order.
3. Keep migrations idempotent where possible (`IF NOT EXISTS`).

