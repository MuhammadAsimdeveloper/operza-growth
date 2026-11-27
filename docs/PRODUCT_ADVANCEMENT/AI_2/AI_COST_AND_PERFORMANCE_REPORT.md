# AI Cost & Performance Report 2.0

## 1. Cost & Budget Governance
- `cost-governance.mjs` enforces per-request `defaultMaxTokensPerRequest` (`8192`), per-user rate limits (`30/min`), and monthly tenant budgets (`ai_usage_events` tracks `estimated_cost_microcents` separately from `actual_provider_cost_microcents`).
- `model-router-v2.mjs` prevents silent paid-model fallback when `remainingBudgetMicrocents <= 0` or `allowPaidFallback === false`.

## 2. Bounded Runtime & Indexing
- Agent runs enforce `maxSteps <= 25`, `maxToolCalls <= 30`, `timeoutMs <= 60,000`, and `MAX_DELEGATION_DEPTH = 3`.
- `ai_agent_memories_lookup_idx` indexes `(agency_id, location_id, scope, user_id, expires_at)` for fast TTL-filtered retrieval.
