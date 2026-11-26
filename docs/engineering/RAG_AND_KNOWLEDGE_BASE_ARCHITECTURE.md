# Phase 5 — RAG & Knowledge Base Architecture

**Migration:** `packages/db/migrations/037_phase5_ai_platform.sql`
**Repository:** `packages/db/lib/knowledge-base-repository.mjs`
**Pipeline:** `packages/platform-core/src/ai/rag.mjs`

---

## 1. PostgreSQL & `pgvector` Status

- On PostgreSQL instances where the `vector` (`pgvector`) extension is available, `037_phase5_ai_platform.sql` enables `CREATE EXTENSION IF NOT EXISTS vector` and adds `embedding_pgvector vector(1536)` to `ai_knowledge_chunks`.
- On the local Windows PostgreSQL 18 binary (where `pgvector` is not installed), the migration automatically provisions `embedding_vector double precision[]` + `pg_trgm` GIN lexical indexing (`ai_knowledge_chunks_content_trgm_idx`).
- Both `ai_knowledge_sources` and `ai_knowledge_chunks` enforce composite tenant primary keys `(agency_id, location_id, id)`, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` least-privilege grants.

## 2. Durable Ingestion & Grounded Retrieval

1. **Validation:** Allowed types (`text`, `markdown`, `md`, `txt`, `faq`, `crm`, `url`, `pdf`, `docx`), non-empty check, 2 MB cap, SHA-256 checksum.
2. **Processing State:** Source starts in `status = 'processing'`; only transitions to `'ready'` after all chunks and embeddings persist. Failures mark `'failed'` so partial documents are never searchable.
3. **Chunking:** `chunkDocumentWithOffsets()` preserves `startOffset`, `endOffset`, `heading`, `tokenCount`, and overlap.
4. **Hybrid Search & Isolation:** `searchHybrid()` filters by `agency_id`, `location_id`, `s.status = 'ready'`, `s.deleted_at IS NULL` under `FORCE RLS`, scoring `0.55 * cosineSimilarity + 0.45 * lexicalOverlap`.
5. **Prompt-Injection Defense:** Retrieved chunks are sanitized via `sanitizeUntrustedText()` and wrapped in `<untrusted_knowledge_source>` delimiters.
6. **Unanswerable Rule:** Returns `answerable: false` and `citations: []` when no chunks clear `minScore`.
