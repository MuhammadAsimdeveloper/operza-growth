# Tool Governance & Human Approvals

**Module:** `packages/platform-core/src/ai/tool-registry-v2.mjs`

## 1. Risk Classification & Approval Gates
- **Low (`read_only`):** CRM search, knowledge retrieval, reporting summaries.
- **Medium (`reversible_write`):** Drafts, internal tasks, workflow drafts.
- **High (`external_communication`, `financial_operation`, `destructive_operation`):** External messaging, payments, refunds, workflow publishing. Requires human approval (`workflow_approvals` / `ai_tool_calls.approval_id`).
- AI models can never approve their own proposals or override `TenantTx` / RBAC checks.
