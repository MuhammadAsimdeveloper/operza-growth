# Operza Growth — Unified Operza + Atlas Architecture

**Decision:** Operza Growth is the single product and canonical repository. Atlas is the architectural source for selected, tested capabilities—not a second product to deploy or a codebase to merge wholesale.

This document records an implementation audit of both repositories' default branches as inspected on 5 November 2026, and the staged plan for convergence.

## 1. Product direction

Operza should become one unified Business Growth OS for agencies and service businesses:

- **Customer system:** contacts, companies, opportunities, pipelines, tasks, calendars, conversations, forms, reviews and client workspaces.
- **Growth system:** landing pages, websites, funnels, campaigns, attribution, booking journeys and reusable business templates.
- **Automation system:** visual workflows, governed actions, triggers, waits, approvals, execution history, retries and reusable sub-workflows.
- **AI system:** a copilot and task-focused agents that can inspect tenant data, propose changes, prepare workflow drafts and invoke only authorized actions.
- **Platform system:** tenant isolation, provider connections, credentials, audit events, usage controls, observability, billing and deployment operations.

The flagship customer outcome is **lead to booked opportunity**: capture a lead, resolve or create the contact, qualify it, move it through a pipeline, prepare the right follow-up, request approval where required, send through a verified provider, record booking, and show an inspectable timeline.

The product must make the difference between *draft*, *test/simulated*, *approved*, *queued*, *sent*, *delivered* and *failed* explicit. A local database write or a console log is not proof that a provider sent a message.

## 2. Repository audit

### Operza Growth (operza-growth, baseline main 6c00933)

**Keep and strengthen**

- The existing React/Vite workspace and the current CRM, pipeline, calendar, inbox, form, funnel, website/page builder, portal and marketing surfaces.
- The multi-tenant business data model and PostgreSQL migration history, after migration-by-migration review.
- The visual workflow canvas and existing workflow engine as the product-facing authoring/runtime foundation.
- The existing zero-configuration local developer setup where it remains clearly separated from production persistence.
- The existing CI, browser/API smoke tests, SEO checks and container build checks.

**Verified problems in the inspected baseline**

1. **Frontend version drift:** the root README describes React 19, while apps/web/package.json pins react and react-dom to ^18.3.1. Documentation and badges must reflect the actual dependency graph until a deliberate framework upgrade is completed and tested.
2. **Backend concentration:** apps/api/server.mjs is approximately 288 KB and 6,700+ lines. Authentication, routing, CRM operations, provider-like stubs and workflow orchestration are difficult to isolate and test in this shape. Extract modules incrementally; do not rewrite the whole server in one pass.
3. **Unscoped outbound networking:** the workflow executor directly calls fetch() for webhook, http_request and slack_notify nodes using workflow-provided destinations. That bypasses a connector-owned network boundary and creates an SSRF/credential-exfiltration risk. The old security-audit prose claims outbound URL validation, but the inspected execution cases do not enforce a connector-scoped destination policy.
4. **Simulated messaging represented as delivery:** the workflow sendEmail and sendSms adapters log and append local conversation records; sendReviewRequest logs. These are not verified email/SMS/review provider integrations. Existing surfaces must not present these stubs as real delivery.
5. **Approval continuation is incomplete:** the inspected /api/workflows/runs/:id/approve route marks a run completed and sets approvedBy; it does not demonstrate a safe resume from the paused node with the same pinned workflow version and action input. Approval must become a persisted, action-bound decision and resume path, not a status-field flip.
6. **Audit documentation drift:** repository docs cite different test counts and framework claims. Test status must be generated from current CI output, not written as a permanent badge claim.
7. **Test architecture:** workflow-engine unit coverage was concentrated in one small test file, while large end-to-end tests covered API paths. Add focused unit contracts for action policy, state transitions, tenant boundaries and provider adapters.

### Atlas (Atlas-, baseline main b68b534)

**Reuse as architectural patterns**

- **Action fabric:** typed action IDs, input/output contracts, risk levels, approved surfaces and stable action hashes.
- **Approval model:** approvals attached to a tenant, workflow, execution, node and exact action hash; expiry checks, cross-tenant rejection and self-approval rejection.
- **Automation policy:** bounded execution settings, node validation, safe data mapping, security findings, workflow templates and environment promotion plans.
- **Authority and capabilities:** server-derived tenant membership and explicit capability/risk checks. An agent or UI component must not grant itself authority.
- **Operational model:** durable execution identity, idempotency, leases, redacted execution data, retry planning and explicit provider lifecycle.

Atlas is materially more modular and has a broad Node test suite. However, its architecture documents also identify gaps: production worker deployment and real business handlers are not automatically supplied by the repository, and production activation requires external database roles, secrets, TLS, mail and infrastructure setup. Atlas code and documentation are not proof that a provider is connected or a live business action is operational.

**Do not copy wholesale**

- Do not combine Atlas and Operza as two deployable apps inside one runtime.
- Do not import Atlas's entire migration history or duplicate CRM, UI, account, queue and workflow domains into Operza.
- Do not add a Git dependency on a private Atlas repository.
- Do not claim full n8n/GoHighLevel parity or production readiness from package presence or documentation alone.

## 3. First integrated slice: governed workflow actions

The first slice brings Atlas's action-governance approach into Operza's existing @operza/workflow-engine package.

### Action policy

- A small action catalog maps current Operza workflow node types to stable action IDs, risk and provider keys.
- Internal CRM writes remain separate from external side effects.
- Action payloads are bounded plain JSON; credential-shaped fields are rejected.
- Action hashes are deterministic and bind the tenant, workflow, execution, actor, node, mode, provider status, consent and input.
- Approval evidence is tied to the exact tenant, workflow, execution, node and action hash. Decisions reject self-approval, expired requests and tenant mismatch.
- Approval checksums detect accidental mutation; they are **not** a substitute for trusted persistence or an authorization signature. Production callers must load approval records from server-controlled storage, never trust browser-supplied approval evidence.

### Runtime behavior

- External email/SMS/review actions default to dry_run and return a simulated result with sideEffectsDisabled: true. They do not invoke Operza's local logging stubs.
- A live external action is denied unless its provider is marked verified, consent is explicitly present, the action-bound approval is valid and a trusted provider executor is injected by the server.
- Raw webhook, http_request and slack_notify destination nodes fail closed. A later connector implementation must use registered provider/operation references, bounded request schemas, egress controls and server-held credentials—not a user-supplied URL.
- Provider results are not copied wholesale into workflow execution data; the runtime keeps a minimal dispatch outcome.
- The visual workflow editor can continue to author existing nodes, but unsafe direct-network nodes must be replaced by connector-scoped actions before they can execute.

### Important boundary

This slice is a policy and execution contract. It does **not** add a real mail, SMS, Slack or review provider, a secret vault, a durable approval database, a production worker or live payment processing. No live provider is enabled by this change.

## 4. Target architecture

The intended repository structure is:

- apps/web: Operza product UI—CRM, growth, builder, workflow studio and inbox.
- apps/api: HTTP boundary, auth/session, tenant resolution and small route modules.
- apps/worker: isolated execution process, introduced only after durable queue and provider review.
- packages/shared: domain contracts and validation primitives.
- packages/db: PostgreSQL schema, migrations and RLS policies.
- packages/workflow-engine: graph traversal, step state machine and execution timeline.
- packages/action-governance: future extraction of action registry, policy, approvals and audit.
- packages/integrations: provider contracts, OAuth lifecycle and secret references.
- packages/ai-runtime: grounded copilot/agent orchestration with bounded tools.
- packages/observability: structured events, traces, metrics and retention policy.

The current implementation starts governance inside packages/workflow-engine to avoid introducing a workspace/package-lock migration during the first safety change. Extract it to a dedicated package only when the contracts stabilize.

## 5. Delivery roadmap

### Phase 1 — governed workflow foundation (started)

- [x] Add a typed action catalog with risk and provider metadata.
- [x] Build bounded action invocations with deterministic hashes.
- [x] Reject secret-shaped action input.
- [x] Add tenant/action-bound approval request and decision contracts.
- [x] Reject self-approval, cross-tenant approval, tampered approval and expired approval.
- [x] Default external messaging to safe simulation.
- [x] Disable direct-URL workflow network nodes until a connector-owned egress path exists.
- [x] Add focused unit and engine integration tests.
- [ ] Verify the branch with the repository's complete CI matrix before merge. The first two attempts exited before runner assignment (runner_id 0, zero steps/logs); a fresh run is queued, so source verification remains open.

### Phase 2 — durable approvals and execution records (approval slice implemented; operational guarantees remain open)

- [x] Persist approval requests and decisions with requester, approver, tenant, location, execution, node, action hash, request time, expiry and audit events.
- [x] Persist the workflow snapshot and version on the execution; resume from the paused node rather than reloading a mutable draft.
- [x] Add explicit `waiting_approval`, `resuming`, `completed` and `failed` transitions; persist the approved transition before resuming.
- [x] Reject self-approval, cross-tenant/workspace decisions, expired requests, altered action payloads and repeated decisions.
- [x] Scope approval to one node only; later approval-gated nodes must request their own decisions.
- [x] Add pending-approval list, approve/reject API routes, execution recovery for persisted `resuming` state, and redacted execution responses.
- [x] Pass the deterministic action hash to trusted provider executors as the idempotency-key contract.
- [ ] Add a transactional outbox/action-receipt store and enforce deduplication with a real provider's idempotency API. A hash passed to an adapter is not proof of exactly-once delivery.
- [ ] Add attempt history, provider acknowledgement/delivery lifecycle and a richer redacted execution inspector after provider adapters exist.
- [ ] Move approval and execution records from the monolithic application-state envelope into normalized tenant-scoped tables with transactional compare-and-set semantics before multi-instance worker deployment.

**Persistence boundary:** Current approval records are stored in `state.workflowApprovals` and written through `saveState()` to the atomic JSON file or the PostgreSQL `operza_app_state` snapshot. This survives a single application restart but is not a normalized approval table, transactional outbox, or multi-worker lease. The current change does not activate any mail, SMS, Slack, review or payment provider.

### Phase 3 — provider and consent foundation (core contracts implemented; real adapters open)

- [x] Add a fixed provider catalog and connection lifecycle: pending verification, verified, degraded and revoked.
- [x] Store references to server-side secrets only; public connection projections never return the reference or secret.
- [x] Add workspace-scoped connection create/list/revoke APIs and a fail-closed verification route.
- [x] Add explicit consent records for email, SMS and WhatsApp purposes, proof references, revocations and policy tests.
- [x] Keep live dispatch disabled in the catalog and keep Stripe/payments blocked.
- [ ] Implement a real secret resolver/vault adapter and provider-specific verification adapters.
- [ ] Implement actual email/SMS/WhatsApp send adapters with recipient-level consent rechecks, webhook authentication, delivery receipts and synthetic provider contract tests.
- [ ] Run migrations 008–009 and verify the normalized repository path in a provisioned PostgreSQL environment before enabling PLATFORM_DB_ENABLED.

### Phase 4 — durable automation operations (outbox foundation implemented; workflow dispatch integration open)

- [x] Add normalized PostgreSQL tables for workflow approvals, action receipts and the workflow outbox.
- [x] Add tenant-scoped outbox enqueue, deduplication, SKIP LOCKED claims, renewable leases, acknowledgement, retry scheduling and dead-letter transitions.
- [x] Add a separate worker entrypoint that requires the dedicated operza_worker DB role and a trusted handler module.
- [x] Add bounded worker concurrency, handler allow-listing and lease-loss protection.
- [ ] Route workflow triggers/resumes and future provider actions through a transactional outbox rather than executing all work inside the API process.
- [ ] Create trusted event handlers, action receipt claims/completion in each provider action, and provider-side idempotency.
- [ ] Persist scheduled waits, retries, worker heartbeats/metrics, dead-letter operations and graceful drain/recovery.
- [ ] Run multi-worker integration/load tests against PostgreSQL and verify tenant fairness, lease expiry and recovery before scale claims.

### Phase 5 — AI workforce and growth intelligence (permission and proposal foundation implemented)

- [x] Add a typed Copilot tool catalog with read/write risk metadata and actor-role, tenant-capability and agent-grant checks.
- [x] Restrict natural-language write intent and explicit write tools to tenant-scoped proposals; no write tool executes during chat.
- [x] Add proposal list, approve and reject routes. Proposal approval records the decision only and explicitly returns not_executed.
- [x] Add deterministic permission evaluation fixtures for viewers, members, admins, missing grants and disabled tenant capabilities.
- [ ] Add a trusted proposal executor that applies approved CRM changes with optimistic version checks, audit receipts and idempotency.
- [ ] Integrate the actual LLM runtime, grounded retrieval, agent skills and scoped memory after authorization is enforced server-side.
- [ ] Add quality evaluations for qualification, booking, customer support, refusal, safe handoff and prompt-injection scenarios; quality does not grant authorization.
- [ ] Implement the first lead-to-booking product template with full test and delivery-state evidence.

### Phase 6 — commercial foundation (unpriced entitlements and usage metering implemented)

- [x] Add static beta/studio/growth/enterprise capability catalogs with pricing null; do not invent product prices.
- [x] Add tenant entitlements and limits, plus current UTC-month usage event tracking and quota enforcement for manual workflow runs and Copilot requests.
- [x] Add normalized PostgreSQL tables/repository for tenant entitlements and idempotent usage events; JSON storage remains the default local fallback.
- [x] Keep messages at zero entitlement, live messaging disabled and payments disabled for every plan.
- [ ] Build real billing/subscription lifecycle only after pricing, tax, invoicing, payment webhooks, reconciliation, refunds and financial controls are designed and verified.
- [ ] Add seat/location/workflow-count enforcement and recurring usage aggregation from durable normalized storage.
- [ ] Connect plan changes to a trusted billing event flow; never trust client-selected plan IDs or client-side payment success.

**Deployment gate for this branch:** apply migrations 008–009 with MIGRATION_DATABASE_URL; set up the worker role with packages/db/operations/provision_worker_role.sql; then set PLATFORM_DB_ENABLED=true only after DB access and RLS tests pass. Real provider delivery and payments remain off.

## 6. Definition of done for the unified product

The flagship lead-to-booking journey is complete only when a user can:

1. Capture and deduplicate a lead inside the correct tenant.
2. See the contact, opportunity, qualification result and workflow version.
3. Test the path with side effects disabled and inspect every simulated step.
4. Connect and verify an actual provider using server-held credentials.
5. Check consent and recipient policy before any outbound message.
6. Request and record a separate human approval when policy requires it.
7. Execute exactly once under retries and see the real provider acknowledgement/delivery state.
8. Book or reschedule an appointment and update the pipeline.
9. Inspect a redacted audit timeline and safely recover from a failed or interrupted execution.

A polished canvas or feature checklist alone does not satisfy this definition.
