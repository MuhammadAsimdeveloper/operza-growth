# Unified Operza + Atlas — Architecture Audit and Build Plan

**Status:** Initial architecture baseline  
**Target repository:** `MuhammadAsimdeveloper/operza-growth`  
**Source reference:** `MuhammadAsimdeveloper/Atlas-`  
**Working branch:** `feat/unified-operza-atlas-foundation`

## Product decision

Operza Growth is the sole product and repository. Atlas is an architectural and domain-capability reference; it is not a second product to deploy or a codebase to copy wholesale.

The product goal is one multi-tenant Business Operating System for agencies and growing businesses:

- CRM and customer/revenue operations
- Visual workflow automation and durable execution
- Governed AI agents and optional operator Copilot
- Websites, forms, landing pages and funnels
- Unified customer communications and service desk
- Calendars, appointments and customer journeys
- Commerce, invoices, subscriptions and project/client portals
- Integrations, webhooks, developer APIs and operational observability
- Agency workspaces, permissions, templates and white-label controls

A capability is not complete merely because it has a UI, route, registry entry, saved workflow definition or provider name. Completion requires persistence, authorization, tests, observable execution evidence and (for external services) verified provider sandbox/live evidence.

## Repository audit

### Operza Growth — keep as the product shell

Verified from `main`:

- npm workspaces monorepo with `apps/web`, `apps/api`, `packages/db`, `packages/shared` and `packages/workflow-engine`.
- Web app is React 18.3.1 + Vite 5 + TypeScript 5.6; the README badge and architecture copy claim React 19. This is documentation drift; do not upgrade React merely to match a badge.
- API package is Node ESM with PostgreSQL driver and WebSocket dependency.
- Root scripts include workflow-engine tests, SEO checks, E2E script, web build and typecheck.
- Existing UI/product surface includes CRM, workflow canvas, funnel/page builder, Copilot, client portal and agency features.
- README advertises a broad feature set and a 72-test E2E harness. Treat those as repository claims until each behavior is traced to implementation and independently verified.
- `apps/api/server.mjs` is a large centralized HTTP server with in-memory/state-store collection handling and route-specific business logic. This is a major modularity and correctness risk.
- Local JSON fallback is useful for development but must never become the production source of truth for tenant business data or durable execution.
- Webhook creation currently accepts broad HTTP(S) target URLs and stores a caller-provided/generated secret in application state; delivery is not demonstrated by a successful test ping. This requires a reviewed SSRF-safe outbound delivery service, encrypted secret storage, signature verification, retries and delivery evidence.
- Branding verification routes in the inspected server source set verification flags directly. They must be replaced by real DNS/email challenge verification before any verified status is shown.
- The README describes RLS and CSRF as core guarantees; those guarantees must be checked route-by-route and against actual database policies rather than inferred from labels.

### Atlas — selectively adopt its engineering foundations

Verified from `Atlas-`:

- Its architecture explicitly separates platform owner, tenant actor, AI agent, provider adapter and worker trust boundaries.
- Tenant authority is resolved server-side; agents do not gain authority from prompts or assigned skills.
- Its production architecture uses managed PostgreSQL as authoritative state, forced tenant RLS, restricted API/worker roles and versioned migrations.
- Durable PostgreSQL jobs are authoritative; Redis is an optional acceleration/wakeup layer, not the durable source of truth.
- Execution is designed around authorization → agent/tool policy → risk/approval → durable action/job → provider adapter → audit/telemetry.
- It has substantial domain contracts for CRM, customer lifecycle, workflow policy, agents, service desk/SLA, voice lifecycle, transactional operations, connectors, imports and journey execution.
- Atlas documentation explicitly distinguishes source contracts and CI evidence from connected providers, staging qualification and production deployment.
- Its own docs contain release/version drift: package metadata says 153.0.0 while the AI build entry describes later V-series journey work (V166). Verify the current branch and exact implementation/tests before importing any claimed capability.
- Atlas explicitly reports external gates: provider credentials, live messaging/telephony/calendar/model execution, managed PostgreSQL/RLS staging evidence, worker/Redis recovery, backup/restore and production observability. Do not present these as live features.

## What to combine

| Domain | Operza contribution to retain | Atlas contribution to adopt |
|---|---|---|
| Workspace UI | Existing CRM shell, canvas, page builder, portal | Laptop-first command center, journey-oriented navigation and evidence/status language |
| CRM | Existing contacts, pipelines, tasks and agency workflows | Versioned domain contracts, trusted tenant scoping, revisions, dedupe/import audit |
| Automation | Existing visual graph and workflow editor | Canonical node/event contracts, immutable releases, policy validation, durable run state, replay/idempotency |
| AI | Existing Copilot UI and knowledge surface | Tool capability intersection, bounded runtime, redacted traces, evaluation gates, proposal/approval workflow |
| Communications | Existing channel/inbox concepts | Consent/suppression/frequency checks, template releases, provider receipts and webhook dedupe |
| Service desk | Existing tasks and client portal | Cases, business-hours SLA, human handoff and capacity-aware suggestions |
| Journeys | Existing CRM + forms/funnels | Lead-to-booking plan/preview/execute/report with durable, tenant-bound outcomes |
| Infrastructure | Existing Node/Postgres starting point | Forced RLS, restricted roles, migration integrity, durable queue, separate API/webhook/worker services |
| Developer platform | Existing API/webhook UI | OAuth/secret references, safe adapters, signed webhooks, idempotency and delivery ledger |

## Target architecture inside Operza

1. **apps/web** — React workspace. Keep the existing visual language and Figma-inspired workflow shell; modules consume typed API contracts, not local mock state.
2. **apps/api** — thin HTTP composition layer: authentication/session, tenant resolution, CSRF/origin controls, input validation, rate limits and service invocation.
3. **packages/domain** — pure domain rules and stable business contracts shared by API/workers.
4. **packages/application** — use cases/orchestration: CRM, journeys, workflow authoring, approvals, inbox, billing and support.
5. **packages/workflow-engine** — canonical graph validation/compiler and deterministic execution semantics. Avoid a second engine.
6. **packages/integration-fabric** — provider-neutral adapter contracts, OAuth/credential references, webhook verification/dedupe, outbound delivery and reconciliation.
7. **packages/agent-runtime** — model-neutral bounded agent turns, tool authorization, evaluations, approvals and redacted traces.
8. **packages/db** — immutable SQL migrations, tenant RLS policies, least-privilege role grants and repository adapters.
9. **apps/worker** — separately runnable durable job consumer, scheduler and provider delivery handlers.
10. **ops** — deployment preflight, health/readiness, metrics/traces, backups/restore and staging runbooks.

PostgreSQL is the source of truth. Redis may accelerate locks, cache or wakeups only. Local JSON is development/demo-only and must not be used for production writes.

## Security invariants

- Derive actor and tenant from a verified server session/membership, never request-body IDs, UI state or model output.
- Separate platform-owner, tenant-admin, member and worker authority.
- Enforce tenant isolation in service/repository boundaries and PostgreSQL RLS; test negative cross-tenant access.
- Validate origin/CSRF before parsing or mutating request bodies where applicable.
- Never allow arbitrary outbound URLs. Webhooks and URL-fetch nodes require SSRF defenses, DNS/IP revalidation, private/link-local range blocking, redirect policy, timeouts and egress controls.
- Store provider secrets encrypted or as managed secret references; never return them in API payloads, logs, exports or workflow definitions.
- Require explicit consent, suppression and frequency checks immediately before customer messaging.
- Require approval for high-risk actions; bind approval to tenant, exact action, resource, workflow/agent release and expiry.
- Make side effects idempotent; preserve durable attempts, provider receipts, replay protection and audit events.
- Fail closed on missing policy, provider, migration, tenant or production evidence.

## Delivery sequence

### Phase 0 — baseline and guardrails (this branch)
- Record the audit and target architecture.
- Inspect the current Operza tree, test commands, CI and migration/RLS implementation before behavior changes.
- Establish a feature branch and protect `main`.
- Create a capability ledger distinguishing implemented, partial, mocked, externally gated and missing.

### Phase 1 — tenant and persistence foundation
- Verify/fix session-derived actor and tenant resolution.
- Establish PostgreSQL-only authoritative production repositories and forced RLS.
- Add restricted API/migration/worker roles and migration integrity checks.
- Remove fake verification states and unsafe webhook URL handling.
- Add focused tests for authorization, CSRF, tenant isolation, SSRF and persistence failure.

### Phase 2 — modular application core
- Extract one bounded vertical slice at a time from `server.mjs` into domain/application/repository modules.
- Keep route contracts stable while moving logic behind services.
- Introduce typed shared DTOs and runtime validation.
- Avoid a risky big-bang rewrite.

### Phase 3 — governed automation
- Define canonical trigger/node/action schemas and versioned workflow releases.
- Compile/validate graphs before activation.
- Add durable workflow runs, step history, wait/resume, cancellation, retry, replay and idempotency.
- Add worker handlers only when they have real tested implementations.
- Keep preview/simulation distinct from live execution.

### Phase 4 — customer journey and communications
- Implement lead capture → dedupe → qualification → consent-aware follow-up proposal → booking → pipeline update → outcome reporting.
- Add inbox/outbox, message templates, provider receipts and webhook reconciliation.
- No sending until provider sandbox, consent and replay tests pass.

### Phase 5 — AI workforce
- Add governed agent authoring, bounded tools, test/evaluation scenarios, release pinning and human handoff.
- Copilot creates proposals through the same application services; it never bypasses authorization or directly performs unapproved writes.

### Phase 6 — business platform expansion
- Service desk/SLA, calendars, commerce/finance, projects/portals, developer APIs, integration catalog and white-label.
- Each vertical is delivered end-to-end, not as disconnected screens.

### Phase 7 — production qualification
- Staging migration/RLS, provider sandbox, worker recovery, load/backpressure, backups/restore, monitoring/SLO and security review.
- Publish exact tested commit and evidence. No scale or production-readiness claims without measurements.

## First implementation slice

The first code slice after this architecture baseline should be **tenant authority + repository boundary audit**, not another feature screen:

1. Map all auth/session middleware and every API route that reads or writes tenant-owned records.
2. Identify every route that trusts request-body tenant/agency/location/role values.
3. Map JSON-store and PostgreSQL paths, including dual-write failure behavior.
4. Inspect SQL migrations and actual RLS policies/grants.
5. Add regression tests for cross-tenant read/write, forged tenant IDs, unauthenticated requests and partial persistence failure.
6. Fix the highest-risk boundary before extracting the next module.

## Acceptance criteria for every slice

- Tests are written first for new behavior and security regressions.
- Focused tests pass, then the repository's full test/build/typecheck/CI commands pass.
- Authorization-negative and cross-tenant cases are covered.
- Failure, retry, replay and idempotency are tested for side effects.
- No mocked provider or fake verification is represented as live.
- Docs and capability ledger match code and test evidence.
- Main remains untouched until a reviewed PR is ready.
