# Retry & Stuck-Execution Recovery Policy

## 1. Failure Classification (`classifyWorkflowFailure`)
- **Transient / Retryable**: `transient_network`, `rate_limit`, `provider_outage`, `lease_expired`, `timeout`.
- **Permanent / Non-Retryable**: `invalid_config`, `permission_denied`, `validation_error`, `approval_rejected`.

## 2. Bounded Backoff Policy (`normalizeRetryPolicy` / `computeRetryBackoffMs`)
- `maxAttempts`: `1..10` (default `3`)
- `baseDelayMs`: `1000..60000` (default `5000`)
- `maxDelayMs`: `baseDelayMs..3600000` (default `300000`)
- `jitter`: boolean (default `true`, `0.5x–1.0x` multiplier)

## 3. Side-Effect Safety (`evaluateRetryEligibility`)
- Retries **never** execute against a newer workflow version; they preserve the execution's original `workflow_version` and `workflow_snapshot`.
- Any execution with `external_side_effect` nodes (`ACTION_CATALOG` in `action-governance.mjs`) or `indeterminate` `workflow_action_receipts` returns `SIDE_EFFECT_CONFIRMATION_REQUIRED` (`HTTP 409`) unless the operator explicitly supplies `confirmSideEffectRetry: true`.

## 4. Stuck-Execution Recovery (`detectStuckExecutions` / `recoverStuckExecutionsInDb`)
- Detects `LEASE_EXPIRED`, `MISSING_LEASE`, `HEARTBEAT_STALE`, `EXECUTION_TIMEOUT`, and `OVERDUE_RETRY`.
- Uses `FOR UPDATE SKIP LOCKED` in PostgreSQL to prevent concurrent recovery workers from claiming the same execution.
- Transitions recoverable runs to `retry_scheduled` with exponential backoff, or `dead_letter` once `attempts >= maxAttempts`.
