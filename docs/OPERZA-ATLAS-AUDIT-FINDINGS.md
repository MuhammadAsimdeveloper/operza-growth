# Operza Growth + Atlas — Verified Audit Findings

**Audit date:** 2026-11-06  
**Target:** Operza Growth `main`  
**Architecture reference:** Atlas-`main`  
**Purpose:** Record source-level findings that must shape the unified build. This is a static repository review, not a penetration test or runtime verification.

## Executive assessment

Operza has the broader existing customer-facing product shell, but its API/runtime is not a safe foundation for adding more features without first tightening authority, persistence and outbound execution. Atlas has stronger documented trust boundaries, tenant-safe domain contracts, durable execution design and release/evaluation patterns. Atlas is not production-complete either: its own documentation marks provider execution, managed staging/RLS qualification and several deployment controls as external gates.

**Recommendation:** retain Operza's UI and product identity; adopt Atlas's domain/service/security patterns selectively; do not copy Atlas wholesale or represent either repository's feature inventory as production parity.

## P0 — stop-ship issues to resolve before live customer data or side effects

### 1. Workflow nodes can make arbitrary outbound HTTP requests
Evidence: `packages/workflow-engine/src/engine.mjs` directly calls global `fetch` in `webhook`, `http_request` and `slack_notify` node handlers. URL values can be rendered from workflow context. No tenant-bound connector grant, destination policy, private-address block, DNS revalidation, redirect policy, egress boundary or bounded response policy is enforced in this engine.

Risk: SSRF against loopback/private cloud metadata/internal services, credential exfiltration and abuse of the API/worker network position.

Required design: engine emits a typed outbound-action request to a trusted adapter. The adapter resolves a tenant-authorized named connection, validates scheme/host/IP on every resolution and redirect, blocks private/link-local/reserved ranges, enforces timeouts/body limits and records a redacted delivery result. No arbitrary URL fetch in the pure workflow engine.

### 2. Production startup can silently downgrade from PostgreSQL to JSON
Evidence: `apps/api/server.mjs` initializes PostgreSQL only when `DATABASE_URL` exists; connection failure sets `pgPool = null`; `loadState()` falls back to local JSON when PostgreSQL reads fail; `initDatabase()` announces JSON file mode if PostgreSQL is absent.

Risk: production may start with a different persistence backend than operators expect, causing split-brain, lost writes or misleading readiness.

Required design: explicit environment modes. Production must fail closed if database URL, TLS verification, migrations, role grants or database health are missing. JSON mode must be explicitly development/test-only and readiness must disclose it.

### 3. PostgreSQL and JSON state are dual-written without an atomic transaction
Evidence: `saveState()` persists the global state snapshot, while `syncRelationalWrite()` separately mirrors only selected collections (contacts, tasks, opportunities). Relational sync catches and logs errors rather than failing the API write. The server's `operza_app_state` JSONB snapshot is also separate from normalized relational writes.

Risk: UI success can be returned while normalized persistence fails; records can diverge across the JSONB snapshot, local file and relational tables. Only a subset of collections is mirrored.

Required design: each use case writes authoritative normalized records and its outbox/audit event in one database transaction. Remove dual-write-as-source-of-truth semantics; use a deliberate migration/import process for legacy state.

### 4. Default session secret is embedded in source
Evidence: `apps/api/server.mjs` falls back to `operza-local-development-secret-key-32chars` when `SESSION_SECRET` is absent.

Risk: deployments that omit configuration may share a predictable signing secret.

Required design: fail startup in production when secret material is absent or weak; rotate via managed secret storage; never log or return secrets.

### 5. Server-level PostgreSQL TLS option can disable certificate verification
Evidence: server pool configuration uses `ssl: { rejectUnauthorized: false }` when `DATABASE_SSL=true`.

Risk: TLS encryption without server identity verification permits interception in hostile networks.

Required design: verify certificates by default in production; support an explicit CA bundle path for private provider roots; never use `rejectUnauthorized: false` as a production mode.

### 6. Webhook registration and verification are not production-grade
Evidence: webhook creation accepts caller-provided URLs and secrets and stores the secret in application state. The test endpoint in the inspected route creates a synthetic successful delivery record rather than proving a network delivery. Branding domain/email verification routes set verified flags directly instead of completing DNS/email challenges.

Risk: SSRF, exposed secrets, fake delivery/verification status and incorrect customer trust.

Required design: encrypted secret references; challenge-based domain/email verification; signed outbound payloads; actual sandbox delivery; bounded retries; delivery receipts; endpoint revalidation; disable synthetic success in production.

## P1 — architecture and reliability risks

### 7. One large API server owns too many responsibilities
Evidence: `apps/api/server.mjs` combines session/auth, CORS/CSRF, persistence, CRM CRUD, workflow triggers, webhook handling, agency branding, billing and WebSocket behavior.

Risk: authorization inconsistencies, hidden coupling, hard-to-test behavior and risky feature changes.

Required design: thin HTTP routes + typed application services + repositories + provider adapters. Extract one vertical slice at a time; avoid a big-bang rewrite.

### 8. Queue fallback is not durable
Evidence: `apps/api/queue.mjs` falls back to process-memory arrays for ready/delayed/dead-letter jobs and in-memory idempotency keys. Restart loses these records. Redis errors also fall back to memory.

Risk: queued customer actions disappear on restart or Redis outage while the system may continue accepting work.

Required design: PostgreSQL durable job/outbox table with leases, attempt counters, bounded retry, dead-letter state and idempotency. Redis may be an optional wake-up/cache layer only. Fail readiness or reject durable enqueue if no durable backend exists.

### 9. Workflow engine treats HTTP status as completion
Evidence: direct HTTP handlers return `status: 'completed'` with `httpStatus` without requiring a successful response or classifying retryable/permanent outcomes. Similar direct network calls bypass connector policy.

Risk: failed provider actions can be reported as completed; retries/replays may duplicate side effects.

Required design: typed adapter outcomes, explicit success policy, retryability classification, unknown-outcome reconciliation and idempotency key bound to the workflow release/run/node/attempt.

### 10. WebSocket broadcast is global process state
Evidence: `broadcast()` iterates every connected socket and sends the event payload without visible per-socket tenant subscription filtering in the inspected implementation.

Risk: cross-tenant event disclosure unless every event and connection path is further constrained.

Required design: authenticated WebSocket handshake, tenant-bound subscription authorization and event-level tenant filters; add negative cross-tenant tests.

### 11. CORS/security policy is hard-coded and incomplete as a deployment model
Evidence: `sendJson()` emits a fixed localhost origin with credentials. This may block valid deployments while not establishing a configurable strict origin allowlist. Review the full OPTIONS/CSRF middleware before relying on this as protection.

Required design: explicit allowed-origin configuration, exact origin validation, secure cookie settings, CSRF validation for state-changing requests and tests for hostile/missing origins.

### 12. Workflow engine is not a pure deterministic domain boundary
Evidence: engine mixes graph logic with global network fetch, nondeterministic split-test randomness, wall-clock defaults, AI handler calls and CRM side effects. Tests cover a limited subset of node types.

Risk: difficult replay, preview/runtime drift, side-effect duplication and hard-to-reproduce runs.

Required design: pure graph compiler/validator and deterministic step semantics; inject clock/random sources; route all side effects through authorized application/adapter handlers; pin immutable workflow releases.

## Atlas capabilities worth adopting

- Server-derived tenant/actor authority with distinct platform, tenant, agent and worker roles.
- Forced RLS and restricted database roles; migration identity separate from API/worker.
- PostgreSQL-backed durable queue, atomic outbox handoff, leases, retry and recovery.
- Immutable/version-pinned workflow and agent releases with checksums.
- Explicit approval contracts bound to exact action/resource/run and short expiry.
- Consent, suppression and frequency checks at delivery time; message templates pinned to immutable releases.
- Redacted execution traces, audit metadata, evaluation evidence and service-level objectives.
- Business-hours SLA with timezone/DST and holiday-aware deadline calculation.
- Lead-to-booking journey preview, reviewed-plan execution and idempotent persisted outcome reporting.
- Truthful status labels separating source implementation, tests, staging, external provider activation and production deployment.

Do not import Atlas's sample/demo UI as live data, copy its platform-owner shortcuts, or claim live provider connectivity. Its own roadmap/launch documentation says staging PostgreSQL, forced RLS qualification, real provider execution, worker recovery and production operations remain external gates.

## Audit limitations

- This review inspected selected source files and repository documentation through GitHub; it did not clone either repository or execute tests.
- No penetration test, staging database, production deployment, provider sandbox, load test or restore drill was performed.
- Atlas README/package version and later V-series roadmap notes are inconsistent; confirm current branch/commit and CI before selecting code for migration.
- Operza README claims React 19 while `apps/web/package.json` pins React 18.3.1. Root test/CI descriptions also differ (README says 72 tests; workflow comment says 68 integration tests). Run actual scripts before using any badge/count as evidence.

## Immediate build order

1. P0: production fail-closed startup and persistence authority.
2. P0: remove direct HTTP fetch from workflow engine; use tenant-authorized outbound adapter.
3. P0: enforce tenant-scoped WebSocket subscriptions and verify auth/CSRF/origin behavior.
4. P0: real webhook verification and delivery lifecycle; no synthetic verification.
5. P1: durable PostgreSQL queue/outbox and idempotent worker.
6. P1: modularize CRM vertical slice with tests and typed contracts.
7. Then expand journeys, AI agents, inbox, funnels, billing and portals through the same governed service layer.
