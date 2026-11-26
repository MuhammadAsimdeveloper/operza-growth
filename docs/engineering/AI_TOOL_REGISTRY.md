# Phase 5 — Secure AI Tool Registry

**Module:** `packages/platform-core/src/ai/tool-registry-v2.mjs`
**Integration Bridge:** `createIntegrationHubSdk` (`packages/platform-core/src/integration-sdk.mjs`)

---

## 1. Risk Classification Tiers

| Risk Class | Approval Required | Default Minimum Role | Idempotency Required |
| --- | --- | --- | --- |
| `read_only` | No | `viewer` | No |
| `reversible_write` | Configurable | `member` | Yes |
| `external_communication` | **Yes** | `member` | Yes |
| `financial_operation` | **Yes** | `admin` | Yes |
| `destructive_operation` | **Yes** | `admin` | Yes |

## 2. Authorization & Governance Pipeline

Every tool call goes through `authorizeAndExecute()`:
1. Verify registered tool exists (`TOOL_NOT_REGISTERED`).
2. Verify trusted `tenantContext` (`agencyId`, `locationId`).
3. Verify authenticated actor role meets `requiredRole` (`FORBIDDEN_ROLE`).
4. Validate arguments strictly against `inputSchema` (no undeclared properties, 16 KB cap, credential-key rejection `CREDENTIAL_IN_TOOL_ARGS`).
5. Enforce human approval evidence (`HUMAN_APPROVAL_REQUIRED` -> `status: 'proposal_required'`) for high-risk or approval-gated tools.
6. Apply idempotency key deduplication (`deduplicated: true`) and execution timeout (`TOOL_TIMEOUT`).
7. Record audit event via `auditSink`.
