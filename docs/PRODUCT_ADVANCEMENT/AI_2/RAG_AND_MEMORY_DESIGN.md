# RAG & Memory Design 2.0

**Modules:** `packages/platform-core/src/ai/rag-v2.mjs`, `memory-manager-v2.mjs`  
**Tables:** `ai_knowledge_sources`, `ai_knowledge_chunks`, `ai_agent_memories`

## 1. Document Ingestion & Retrieval
- **Signature Verification:** `validateDocumentUpload` checks magic bytes (`%PDF` for PDF, `PK\x03\x04` for DOCX) and blocks executable extensions instead of trusting file extensions alone.
- **Hybrid Retrieval & Token Budget:** `hybridRetrieveWithBudget` excludes `deleted` documents and cross-tenant chunks, neutralizes prompt-injection patterns (`sanitizeUntrustedText`), deduplicates content, and caps selected chunks by `maxTokensBudget`.
- **Conflict Detection:** `detectSourceConflicts` flags differing numeric/policy values across distinct source documents.
- **pgvector Note:** `037_phase5_ai_platform.sql` conditionally enables `vector(1536)` when the `vector` extension is installed; otherwise PostgreSQL `double precision[]` + `pg_trgm` hybrid retrieval is used.

## 2. Scoped Memory
- `user`-scoped memories are strictly isolated by `(agency_id, location_id, user_id)`.
- `agency`-scoped memories are shared within the tenant location.
- Secret/credential keys are rejected, explicit `consentGranted` is required, and expired TTL records are excluded from retrieval.
