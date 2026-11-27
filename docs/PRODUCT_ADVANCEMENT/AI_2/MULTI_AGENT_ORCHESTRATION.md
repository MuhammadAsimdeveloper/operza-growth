# Multi-Agent Orchestration

**Module:** `packages/platform-core/src/ai/agent-orchestrator-v2.mjs`  
**Table:** `ai_delegations` (`043_ai_2_0.sql`)

## 1. Specialized Agent Profiles
Defines 10 specialized agents: `research`, `crm_assistant`, `workflow_designer`, `customer_support`, `marketing_assistant`, `data_analysis`, `integration_assistant`, `reporting_assistant`, `knowledge_assistant`, and `operations_assistant`.

## 2. Security & Depth Bounds
- `MAX_DELEGATION_DEPTH = 3` (enforced in runtime and PostgreSQL `CHECK (depth >= 1 AND depth <= 3)`).
- **Strict Permission Intersection:** `effectiveTools = specialist.allowedTools ∩ parentAllowedTools`, ensuring a delegated specialist never gains permissions the parent did not possess.
- All delegations inherit the parent's `agencyId` and `locationId`.
