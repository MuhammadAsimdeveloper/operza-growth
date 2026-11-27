# Event Contracts & Delivery

- `CANONICAL_EVENT_CONTRACTS` (`packages/platform-core/src/cross-platform-events.mjs`) defines schema version `2.0` contracts across CRM, Support, Engagement, Commerce, Workflows, and Portal.
- `createCrossModuleEventEnvelope` enforces tenant scope (`agencyId`, `locationId`, `entityId`), redacts sensitive keys (`redactSensitivePayload`), enforces `loopDepth <= 3` (`WORKFLOW_LOOP_PREVENTED`), and generates deterministic `idempotencyKey` (`idem_<sha256>`) via `generateDeterministicIdempotencyKey`.
- `publishCrossModuleEvent` enqueues events into the existing outbox repository without creating a parallel event bus.
