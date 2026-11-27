# Stage 8 — Performance & Resource Consolidation Report

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

---

## 1. Observed Bundle & Build Metrics
- **Web Production Bundle (`@operza/web`):** `265` modules transformed in `5.78s`.
  - Main entry `index-*.js`: `286.07 kB` (`86.66 kB` gzip).
  - Largest lazy route chunk `Workflows-*.js`: `341.11 kB` (`112.19 kB` gzip, includes `@xyflow/react`), loaded on demand via `React.lazy` + `Suspense`.
  - All other route chunks range between `6 kB` and `93 kB` (`2 kB`–`26 kB` gzip).
- **Marketing Static Build (`apps/marketing`):** `5` pages built in `1.14s`.

## 2. Backend, Database & Async Workload Review
| Workload | Current Execution | Risk / Bottleneck | Recommendation |
|---|---|---|---|
| Small CRM CRUD & Timeline | Synchronous `TenantTx` + trigram/email/phone indexes (`040_crm_2_0.sql`) | Low (`<20ms` typical) | Keep synchronous |
| Large CSV Imports (`>25k` rows) | Synchronous in `parseAndValidateCsvImport` | Event-loop blocking & request timeout on very large files | Queue batches via `outbox-repository.mjs` / Redis worker in staging |
| Workflow Execution & Retries | Durable outbox + lease fencing (`012`, `028`, `031`, `032`) | Chaos `1,000` concurrent jobs across 4 workers passed (`15ms` in-memory); real Redis multi-worker unverified locally | Verify in staging Redis container |
| Analytics & BI Queries | Allowlisted SQL (`LIMIT <= 500`) + `analytics_events` dedup | Bounded | Keep bounded; schedule reports via staging worker |
| AI Agent Runs & RAG | Token budget + rate limit + bounded delegation depth `3` | External LLM latency in production | Enforce timeouts & streaming |
