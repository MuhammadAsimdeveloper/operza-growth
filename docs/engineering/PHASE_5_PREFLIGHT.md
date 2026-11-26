# Phase 5 Preflight — Real AI Infrastructure

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `d136f9a333dcf2eb6abf73d4eb8e478e7e30d7aa` (`d136f9a`)
**Working Tree:** Clean (`[ahead 10]`, not pushed)

---

## 1. Phase 4 Verification Audit

1. **Optimistic Workflow Versioning:** Verified in `packages/db/lib/workflows-repository.mjs` (`WHERE ... AND version = $10` throwing `VERSION_CONFLICT`), `apps/api/routes/workflows.mjs` (HTTP `409 Conflict`), and `packages/db/test/real-postgres-integration.test.mjs`.
2. **Integration Hub SDK:** Verified in `packages/platform-core/src/integration-sdk.mjs` (`createIntegrationHubSdk`) with config validation, per-tenant sliding-window rate limiting, idempotent action execution, and secret-safe error normalization.
3. **Visual Workflow Builder V2:** Verified `@xyflow/react` integration in `apps/web/src/components/WorkflowGraphV2.tsx` inside `WorkflowCanvas.tsx`.
4. **1,000-Job Chaos Test Audit (`packages/workflow-engine/test/chaos-1000-jobs.test.mjs`):**
   - **What it proves:** Deterministic in-memory lease claim/expiry/reclaim (`claimExecutionLease` / `releaseExecutionLease`) across 1,000 in-memory job objects, 4 concurrent async JS loops, 40 injected timeouts/lease expiries, and 0 duplicate entries in an in-memory `Map` (~20 ms).
   - **What it does NOT prove:** It does **not** exercise PostgreSQL persistence, durable outbox rows, multi-process workers, or real network I/O. Real PostgreSQL durability and lease ownership remain covered separately by `scripts/verify-ci-postgres.mjs` (`Durable Workflow Recovery, Resume Leases & Execution Ownership`).

---

## 2. PostgreSQL & `pgvector` Environment Check

- **Installed PostgreSQL:** PostgreSQL 18 (`C:\Program Files\PostgreSQL\18\`).
- **Installed Extensions Checked (`share/extension/*.control`):** `pg_trgm`, `cube`, `pg_stat_statements`, `pg_sphere`, `pg_buffercache`, etc.
- **`pgvector` (`vector.control`) Status:** **NOT INSTALLED** in the local Windows PostgreSQL 18 binary distribution.
- **Phase 5 Migration Strategy (`037_phase5_ai_platform.sql`):**
  - Use conditional DDL that enables `CREATE EXTENSION IF NOT EXISTS vector` and `vector(1536)` + HNSW when `pg_available_extensions` contains `vector`, and automatically provisions `double precision[]` + `pg_trgm` GIN lexical indexing when running on PostgreSQL without the `pgvector` binary extension.
  - Enforce `FORCE ROW LEVEL SECURITY` and `operza_app` tenant isolation on all new AI tables (`ai_knowledge_sources`, `ai_knowledge_chunks`, `ai_agents`, `ai_runs`, `ai_tool_calls`, `ai_usage_events`, `ai_eval_runs`, `ai_voice_sessions`).

---

## 3. Phase 5 Scope & Deliverables

1. **AI Provider Abstraction (`packages/platform-core/src/ai/provider-gateway.mjs`):** Honest provider status (`not_configured`, `configured`, `credential_verified`, `sandbox_verified`, `production_connected`, `temporarily_unavailable`, `disabled`), capability declarations, embeddings, streaming, token/cost estimation, and zero secret exposure.
2. **PostgreSQL RAG & Knowledge Base (`packages/db/lib/knowledge-base-repository.mjs`, `packages/platform-core/src/ai/rag.mjs`):** Durable ingestion pipeline, semantic chunking with source offsets, tenant-isolated hybrid vector + lexical retrieval, source citations, and unanswerable-question handling.
3. **Secure AI Tool Registry & Agent Runtime (`packages/platform-core/src/ai/tool-registry-v2.mjs`, `packages/platform-core/src/ai/agent-runtime.mjs`):** Integration Hub SDK bridge, strict schema validation, explicit risk classes, backend authorization, approval gating, bounded steps/tokens/time, and prompt-injection separation.
4. **Voice AI Streaming (`packages/platform-core/src/ai/voice-streaming.mjs`, `apps/api/routes/ai.mjs`):** Short-lived session token issuance, consent enforcement, incremental streaming chunks, barge-in/cancellation, and usage metering.
5. **AI Evaluation Gates & Cost Governance (`packages/platform-core/src/ai/evaluations/`, `packages/platform-core/src/ai/cost-governance.mjs`):** Versioned datasets, security/prompt-injection/cross-tenant gates, and per-tenant/per-request budget enforcement.
6. **Frontend & Cross-Domain Integration:** TanStack Query hooks + `@operza/ui` integration on `AiTrainer.tsx` and API routes in `apps/api/routes/ai.mjs`.
