# AI 2.0 Security Review

## 1. Threat Controls Verified
- **Prompt Injection Defense:** Retrieved documents are wrapped as untrusted data and sanitized via `sanitizeUntrustedText`; system policies instruct the runtime never to treat retrieved passages as executable tool instructions.
- **Plan & Tool Authorization:** `validateAgentPlan` blocks undeclared tools before execution; `tool-registry-v2.mjs` enforces RBAC, argument schemas, credential redaction, and human approval for high-risk actions.
- **Delegation Privilege Escalation Prevention:** `createMultiAgentOrchestrator` computes `effectiveTools = specialist.allowedTools ∩ parentAllowedTools` and enforces `MAX_DELEGATION_DEPTH = 3`.
- **Tenant & User Isolation (`FORCE RLS`):** `ai_agent_memories`, `ai_agent_plans`, and `ai_delegations` (`043_ai_2_0.sql`) enforce `FORCE ROW LEVEL SECURITY` under `operza_app`, and `listMemories` isolates `user`-scoped memory by `user_id`.
- **Voice AI Honesty:** `voice-streaming.mjs` enforces consent and short-lived session tokens; live Twilio Media Streams requires external Twilio/LLM credentials and is not claimed live from local unit tests.
