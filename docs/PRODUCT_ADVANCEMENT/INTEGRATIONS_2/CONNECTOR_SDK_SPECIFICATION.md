# Connector SDK 2.0 Specification

**Module:** `packages/platform-core/src/connector-sdk-v2.mjs`

## 1. Readiness Levels (Strictly Separated)
- `implemented_adapter`: Adapter code written with schema & error normalization.
- `unit_tested`: Verified with automated mock/unit tests.
- `sandbox_verified`: Verified against provider sandbox environment (e.g., Stripe Connect sandbox).
- `production_configured`: Operator credentials configured in encrypted vault.
- `live_verified`: Verified in live environment with explicit owner approval.

## 2. Error Classification & Circuit Breaker
`classifyProviderError(statusCode, errCode)` classifies errors into `auth_failure`, `rate_limit`, `invalid_payload`, `timeout`, `temporary`, and `permanent`. Five consecutive failures trip the connection circuit breaker (`open` for 60s), reset upon success.

## 3. Workflow Node Export
`exportWorkflowNodes({ grantedScopes })` publishes scoped `connector.<id>.trigger.<name>` and `connector.<id>.action.<name>` nodes to Workflow Builder 2.0, preserving `riskLevel`, `requiresApproval`, `timeoutMs`, and `retryPolicy`.
