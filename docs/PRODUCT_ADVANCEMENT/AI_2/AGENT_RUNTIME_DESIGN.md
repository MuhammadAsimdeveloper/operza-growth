# Agent Runtime 2.0 Design

**Modules:** `packages/platform-core/src/ai/agent-runtime.mjs`, `agent-orchestrator-v2.mjs`  
**Tables:** `ai_runs`, `ai_agent_plans` (`037_phase5_ai_platform.sql`, `043_ai_2_0.sql`)

## 1. Validated Planning & Execution Lifecycle
1. Preflight budget & rate-limit check (`cost-governance.mjs`).
2. Structured plan validation (`validateAgentPlan`) — rejects empty objectives, oversized plans (`> maxSteps`), and undeclared tools before any tool executes.
3. Plan persisted in `ai_agent_plans` linked to `ai_runs` (LLM calls never hold open DB transactions).
4. Bounded execution loop enforcing `maxSteps`, `maxToolCalls`, `timeoutMs`, and `abortSignal` cancellation.
