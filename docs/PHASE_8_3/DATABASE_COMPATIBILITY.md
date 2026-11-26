# Phase 8.3 — PostgreSQL 16 Staging Compatibility Audit

**Target Staging Image:** `pgvector/pgvector:0.8.0-pg16` (pinned in `docker-compose.staging.yml`)
**Local Verified Engine:** PostgreSQL 18 (`39/39` migrations applied under `operza_migrator`)

## Migration Compatibility Audit (`001`–`039`)
- Inspected all 39 SQL migrations for PostgreSQL 17/18-only features (`uuidv7`, `JSON_TABLE`, etc.): **0 occurrences found**.
- All migrations use PostgreSQL 16-compatible primitives (`gen_random_uuid()`, `timestamptz`, `jsonb`, `FORCE ROW LEVEL SECURITY`, `EXCLUDE USING gist`, `pg_trgm`).
- Migration `037_phase5_ai_platform.sql` conditionally enables `vector` and adds `embedding_pgvector vector(1536)` when `pgvector` is present (such as `pgvector/pgvector:0.8.0-pg16`).
- **Execution Status on `pgvector/pgvector:0.8.0-pg16`:** **BLOCKED locally** (Docker Engine unavailable on Windows host). Must be executed on staging boot via `migrate` service.
