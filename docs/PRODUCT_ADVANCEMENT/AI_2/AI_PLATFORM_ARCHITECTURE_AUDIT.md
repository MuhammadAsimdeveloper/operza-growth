# AI Platform Architecture Audit — Product Advancement Stage 4

**Date:** 2026-11-27  
**Branch:** `feat/operza-agency-launch-readiness`  
**Baseline Commit:** `49e7c6f`

## 1. Baseline Triage
Reproduced the 4 Stage 3 baseline test files prior to Stage 4 changes:
- `apps/api/test/phase-2b-independent-verification.test.mjs` (`3.1 Concurrent verification`): 1 failure (`5 !== 9`, pre-existing OTP concurrency race).
- `apps/api/test/release-verification-gaps.test.mjs` (tests `3` & `4`): 2 failures (pre-existing `/api/workflows` response shape mismatch).
- `packages/platform-core/test/provider-adapters.test.mjs` (`Stripe remains disabled`): 1 failure (`INVALID_CREDENTIAL_FORMAT !== PAYMENTS_DISABLED_PENDING_COMPLIANCE`).
- `packages/platform-core/test/phase5-ai-platform.test.mjs`: 5/5 passing.

## 2. Existing Phase 5 Capabilities (Verified in Codebase)
- **Database (`037_phase5_ai_platform.sql`):** 8 tenant-scoped `FORCE RLS` tables (`ai_knowledge_sources`, `ai_knowledge_chunks`, `ai_agents`, `ai_runs`, `ai_tool_calls`, `ai_usage_events`, `ai_eval_runs`, `ai_voice_sessions`). Conditionally enables `vector` (`pgvector`) when available while preserving `double precision[]` + `pg_trgm` hybrid fallback.
- **Provider Gateway (`provider-gateway.mjs`):** Honest `PROVIDER_STATUSES` (`not_configured`..`production_connected`), model capability catalog (`gemini-1.5-flash`, `gpt-4o-mini`, `claude-3-5-haiku-latest`, embeddings), and microcent pricing metadata.
- **Agent Runtime (`agent-runtime.mjs`) & Tool Registry V2 (`tool-registry-v2.mjs`):** Bounded `maxSteps`/`maxToolCalls`/`timeoutMs`, 5-tier `TOOL_RISK_CLASSES`, credential-key rejection, and human approval gating.
- **RAG (`rag.mjs`) & Cost Governance (`cost-governance.mjs`):** Offset-preserving chunking, `INJECTION_PATTERNS` sanitization, per-request token limits, per-user rate limits, and monthly tenant budgets.
- **Routes (`apps/api/routes/ai.mjs`) & UI (`apps/web/src/pages/AiTrainer.tsx`):** Exposes `/api/ai/providers`, `/api/ai/usage`, `/api/ai/tools`, `/api/ai/voice/sessions`, and basic persona/prompt config UI.

## 3. Gaps & Opportunities Identified

| Area | Current State | Gap / Risk | Stage 4 Target |
| :--- | :--- | :--- | :--- |
| **Model Routing & Fallback** | Static `providerId`/`model` selection | No budget-aware capability routing or controlled fallback reporting (`actualModelUsed`, `degraded`) | `model-router-v2.mjs` with readiness states (`configured`, `connection_tested`, `capability_verified`, `operationally_verified`, `unavailable`) and budget-gated fallback |
| **Agent Planning & Multi-Agent** | Single-loop `runAgent` | No persisted/validated structured plan before tool calls; no bounded multi-agent delegation or permission intersection | `agent-orchestrator-v2.mjs` with `validateAgentPlan`, 10 specialized agent profiles, `maxDelegationDepth <= 3`, and strict permission intersection |
| **Memory & Context** | No persistent memory table | Cannot separate `user`-scoped private memory from `agency` knowledge or enforce opt-out/TTL | `ai_agent_memories` (`043_ai_2_0.sql`) + `memory-manager-v2.mjs` with consent, TTL, and `user_id` isolation |
| **RAG & Document Ingestion** | Extension-only `fileType`, single-pass scoring | No magic-byte/MIME validation, no context-window token budgeting, no source conflict detection | `rag-v2.mjs` with MIME/signature validation, hybrid scoring + token budgeting, and `detectSourceConflicts` |
| **DB Persistence & UI** | `ai.mjs` has 4 read/voice routes; `AiTrainer.tsx` lacks agent CRUD, run history, and evals | No API routes for agent builder, test runs, memory, knowledge search, or eval gate execution | `ai-2-repository.mjs`, `apps/api/routes/ai2.mjs`, and `AiStudio2Panel.tsx` in `AiTrainer.tsx` |
