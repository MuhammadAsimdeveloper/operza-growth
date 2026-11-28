# Outbox and Worker Reliability — Stage 18

## 1. Transactional Outbox & Action Receipts

- **Deduplication & Leasing:** Both `createWorkflowOutboxRepository` (PostgreSQL) and `createMemoryOutboxRepository` deduplicate on `(tenantId, idempotencyKey)`, enforce worker lease ownership (`workerId`, `leaseExpiresAt`), support lease renewal, and transition exhausted retries (`attempts >= 5`) to `dead_letter`.
- **Action Receipt Fencing:** `packages/platform-core` verifies claim-token fencing (`ACTION_LEASE_LOST`), terminal receipt immutability (`ACTION_RECEIPT_TERMINAL`), and indeterminate provider states (`PROVIDER_TIMEOUT_INDETERMINATE`).
- **Tenant Context:** Worker handlers propagate `agencyId` and `locationId` inside `TenantTx` (`operza_worker` has `rolbypassrls = false`).

## 2. Honest Infrastructure Boundary

- Local tests verify single-node PostgreSQL outbox and in-memory queue behavior. Multi-node Redis/BullMQ distributed failover has **not** been tested against a live multi-node Redis cluster.
