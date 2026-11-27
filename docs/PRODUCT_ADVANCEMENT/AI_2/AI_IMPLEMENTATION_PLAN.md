# AI Automation & Agents 2.0 — Implementation Plan

**Date:** 2026-11-27  
**Stage:** Product Advancement Stage 4

## 1. Implementation Phases
1. **Database Schema & `FORCE RLS` (`packages/db/migrations/043_ai_2_0.sql`):**
   - `ai_agent_memories`: User/agency scoped memory with `consent_granted`, `expires_at`, and `FORCE RLS`.
   - `ai_agent_plans`: Validated structured execution plans linked to `ai_runs`.
   - `ai_delegations`: Bounded multi-agent delegation audit trail (`depth <= 3`).
2. **Core AI 2.0 Modules (`packages/platform-core/src/ai/`):**
   - `model-router-v2.mjs`: Capability-based model routing, readiness tracking, and budget-safe fallback.
   - `agent-orchestrator-v2.mjs`: Structured plan validation, 10 specialized agent definitions, bounded multi-agent delegation with permission intersection.
   - `memory-manager-v2.mjs`: Scoped memory lifecycle with consent, TTL, and PII/secret filtering.
   - `rag-v2.mjs`: Magic-byte/MIME upload validation, hybrid retrieval with token budgeting, and source-conflict detection.
   - `eval-suite-v2.mjs`: Deterministic CI evaluation suite for accuracy, RAG citations/conflicts, safety, and reliability.
3. **Repository & API (`packages/db/lib/ai-2-repository.mjs`, `apps/api/routes/ai2.mjs`):**
   - Strictly `TenantTx`-scoped agent CRUD, plan persistence, memory CRUD, RAG search, delegation tracking, and evaluation runner.
4. **Frontend AI Studio 2.0 (`apps/web/src/components/AiStudio2Panel.tsx`):**
   - Tabbed workspace in `AiTrainer.tsx` for Agent Catalog/Builder, Test Sandbox, Execution/Cost History, Knowledge/Citations, and Governance/Approvals.
5. **Verification & Documentation:**
   - Unit, security, RAG/memory isolation, and real PostgreSQL `FORCE RLS` tests + 11 AI_2 docs.
