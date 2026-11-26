# Phase 5 AI Architecture Audit

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `d136f9a`

---

## 1. Component Classification

| Component | Location | Status | Findings |
| --- | --- | --- | --- |
| **Provider Abstraction** | `packages/platform-core/src/copilot/ai-provider.mjs`, `llm-runtime/` | **PARTIALLY VERIFIED** | Supports Gemini, OpenAI, Anthropic, Ollama, and `EmbeddedOfflineProvider` fallback, but lacks honest provider status lifecycle, capability declarations, unified embedding interface, and cost/token normalization. |
| **RAG & Knowledge Base** | `packages/platform-core/src/copilot/rag-engine.mjs`, `apps/api/server.mjs` | **PARTIALLY VERIFIED** | Has paragraph chunking + 64-dim trigram vector + BM25-style scoring, but stores documents in `state.records.knowledge` (JSON state) rather than PostgreSQL with `FORCE RLS`, and lacks durable ingestion states or `pgvector` integration. |
| **Tool Permissions & Proposals** | `packages/platform-core/src/tool-permissions.mjs`, `proposal-executor.mjs`, `copilot/tool-registry.mjs` | **VERIFIED** | Strong 4-eyes approval gating (`proposal_only` for writes), `owner`/`admin` execution gate, and `gateAiToolExecution` ledger debit. Missing Phase 4 Integration Hub SDK bridge and explicit 5-tier risk classification. |
| **Copilot & Multi-Agent Runtime** | `packages/platform-core/src/copilot/copilot-service.mjs`, `multi-agent/` | **PARTIALLY VERIFIED** | Has session history, RAG injection, and SSE streaming, but lacks strict per-run token/cost/step/time budgets, persistent `ai_runs` audit rows, and indirect prompt-injection separation markers. |
| **Voice AI Streaming** | *(none)* | **NOT VERIFIED** | No real-time voice streaming session manager, short-lived session token flow, barge-in cancellation, or voice usage metering exists. |
| **AI Evaluation Framework** | *(none)* | **NOT VERIFIED** | No versioned evaluation datasets, rubric/security graders, model comparison records, or CI evaluation gates exist. |
| **AI Cost & Usage Governance** | `packages/platform-core/src/billing-ledger.mjs` (`gateAiToolExecution`) | **PARTIALLY VERIFIED** | Ledger credit gating exists for approved proposals, but there is no per-request token/cost accounting, monthly tenant AI budget enforcement, or voice minute metering. |
| **AI Frontend (`AiTrainer.tsx`)** | `apps/web/src/pages/AiTrainer.tsx` | **PARTIALLY VERIFIED** | Uses raw `useState` + `api` calls without TanStack Query, and lacks provider status, AI usage/budget visibility, or evaluation gate status. |

---

## 2. Security & Governance Gaps Identified

1. **In-memory Knowledge Base:** `/api/ai/knowledge` in `server.mjs` mutates `state.records.knowledge` instead of a `TenantTx`-scoped PostgreSQL repository with `FORCE RLS`.
2. **Unmetered LLM Calls:** `copilotService.chat()` and `chatStream()` do not enforce per-tenant monthly AI budgets or record token/cost usage rows.
3. **Prompt-Injection Boundary:** Retrieved chunks are injected into the system prompt without explicit untrusted-data boundary delimiters and post-retrieval sanitization.
4. **Silent Offline Fallback:** `LLMRuntimeEngine` cascades silently to `EmbeddedOfflineProvider` without surfacing honest `providerStatus` metadata to callers.
