# Phase 3–6 Platform Foundation

**Branch:** `feat/phase-3-6-platform-foundation`  
**Scope:** Provider governance, durable outbox/worker, Copilot permissions and proposal review, tenant entitlements and usage metering.  
**Status:** Source and documentation committed; runtime/CI verification and production activation remain gated.

## 1. What is implemented

### Phase 3 — provider and consent foundation

- A fixed provider catalog exists for SendGrid, Resend, Twilio, Meta WhatsApp Cloud and Stripe.
- Provider connections use server-side secret references (env/vault/KMS naming), never raw credentials from the browser.
- New connections start as `pending_verification`. Public API projections do not return secret references.
- Workspace owners/admins can create, list and revoke connection records.
- The verification API fails closed with `PROVIDER_ADAPTER_UNAVAILABLE` until a trusted provider verifier and secret resolver are installed.
- Consent records are scoped to tenant, location, contact, channel and purpose. Grant records require a proof reference; a revocation is appended as a new event.
- Unit tests cover channel/purpose mismatch, newer opt-outs, expired consent and missing verified provider.

**Not live:** The consent policy module is not yet wired into a real outbound delivery adapter. No SendGrid, Resend, Twilio or Meta send adapter is shipped or verified. No secret vault has been provisioned. No live send toggle is enabled. Payments stay disabled.

**Approval storage distinction:** Migration 008 also creates a normalized `workflow_approvals` table, but the Phase 2 API approval routes still persist their approval records in the existing `state.workflowApprovals` application-state envelope. A normalized workflow-approval repository and API cutover are not part of this branch yet. Do not assume the table is populated simply because the migration exists.

### Phase 4 — durable operations foundation

- Migration 008 adds normalized provider, consent, workflow approval, action receipt, outbox, entitlement and usage tables with tenant RLS.
- Migration 009 adds tenant-scoped Copilot proposals.
- `packages/db/lib/outbox-repository.mjs` implements tenant-scoped enqueue, idempotency-key deduplication, `FOR UPDATE SKIP LOCKED` claims, lease renewal, acknowledgement, retry/dead-letter disposition and unique action receipts.
- `packages/platform-core/src/durable-worker.mjs` executes only trusted handler functions registered under exact event types, uses bounded concurrency, renews leases and refuses to acknowledge a job after lease loss.
- `apps/api/worker.mjs` is a separate worker process. It requires `WORKER_DATABASE_URL` to authenticate specifically as `operza_worker` and a trusted local ESM handler module at `WORKFLOW_JOB_MODULE`.

**Not wired yet:** Existing workflow triggers still execute through the API runtime; all triggers/actions have not yet been placed into the outbox. No event handler module ships in this branch, so the worker intentionally refuses to start until Antigravity adds trusted handlers. Scheduled waits are not yet persisted to the outbox. The outbox is a foundation, not a claim of production exactly-once execution.

### Phase 5 — AI permissions and proposal foundation

- Read tools are catalogued separately from write, workflow and external-side-effect tools.
- Authorization is the intersection of actor role, tenant capability and agent grant.
- Natural-language write intent and explicit write-tool requests are saved as tenant-scoped proposals; Copilot chat does not execute them.
- Proposal list, approve and reject routes exist.
- Approve records the review decision only and explicitly returns `execution.status = not_executed`. This avoids treating approval as proof that a CRM mutation, workflow or message occurred.
- Deterministic evaluation fixtures cover viewer reads, member writes, admin messaging proposals, denied viewer workflow actions and disabled tenant capabilities.

**Not implemented:** A proposal executor, model-quality benchmark, full agent runtime, vector retrieval pipeline or general-purpose code execution. The current Copilot parser is a conservative heuristic layer, not a replacement for a complete LLM function-calling runtime.

### Phase 6 — commercial foundation

- Static beta/studio/growth/enterprise plans expose capability flags and limits.
- All plan prices are `null`; no subscription price has been invented.
- Payments and live messaging are disabled for every plan; message allowance is zero.
- Usage events are deduplicated and aggregated by tenant/month.
- Manual workflow runs and Copilot requests are checked against monthly limits.
- Migrations and the normalized repository support PostgreSQL persistence when explicitly enabled.

**Not implemented:** Billing, subscription lifecycle, tax, payment capture, refunds, reconciliation, seat/location enforcement, marketplace billing or a live plan-change webhook.

## 2. API surface available to the frontend

| Area | Method and route | Current behavior |
|---|---|---|
| Provider catalog | GET `/api/platform/providers` | Fixed provider catalog; live dispatch always false |
| Provider records | GET `/api/platform/connections` | Active workspace connection summaries |
| Provider onboarding | POST `/api/platform/connections` | Creates pending verification record; secretRef is not returned |
| Provider check | POST `/api/platform/connections/:id/verify` | Returns 501 until trusted verifier exists |
| Provider revoke | POST `/api/platform/connections/:id/revoke` | Revokes the active workspace record |
| Consent ledger | GET/POST `/api/platform/consents` | Lists/records workspace contact consent evidence |
| Consent opt-out | POST `/api/platform/consents/:id/revoke` | Appends a revocation event |
| Plans | GET `/api/platform/plans` | Static, unpriced plan catalog |
| Entitlements | GET `/api/platform/entitlements` | Active plan flags and limits |
| Usage | GET `/api/platform/usage` | Current UTC-month counters |
| Copilot proposals | GET `/api/copilot/proposals` | Current workspace proposal inbox |
| Proposal approve | POST `/api/copilot/proposals/:id/approve` | Records approved decision; does not execute |
| Proposal reject | POST `/api/copilot/proposals/:id/reject` | Records rejected decision |

The frontend client already exposes these through `apps/web/src/lib/api.ts`. Shared types are in `packages/shared/src/index.ts`.

## 3. Persistence modes

### Local/default development

Leave `PLATFORM_DB_ENABLED=false`. Platform records use the existing atomic JSON application-state store. This keeps local tests and onboarding independent of a running PostgreSQL service.

### Normalized PostgreSQL

1. Set `MIGRATION_DATABASE_URL` to the privileged migrator connection.
2. Run `npm run db:migrate` to apply migrations 008 and 009 after the existing schema.
3. Ensure the runtime `operza_app` role has the table grants from the migrations.
4. Set `PLATFORM_DB_ENABLED=true` and restart the API.
5. Verify RLS and the provider/consent/proposal/usage repository methods against a provisioned PostgreSQL database before production.

Do not enable `PLATFORM_DB_ENABLED` before migrations and grants are applied. No automatic migration is performed by the API.

## 4. Worker setup

1. Apply migration 008.
2. As a DB owner/superuser, run `packages/db/operations/provision_worker_role.sql`.
3. Set the worker password out-of-band using the deployment secret manager. Do not commit it or reuse the app role.
4. Set `WORKER_DATABASE_URL` to the dedicated worker role.
5. Create a trusted local module that exports a `handlers` object keyed by explicit event type.
6. Set `WORKFLOW_JOB_MODULE` to that local module path.
7. Run `npm run worker`.

The worker checks its DB identity at startup. It rejects unknown event types into dead-letter state, and the worker role is not granted access to CRM contacts or provider secrets. Do not load workflow-supplied JavaScript or user-selected URLs as handler code.

## 5. Verification added

- Platform-core tests: provider lifecycle, secret-reference policy, consent policy, Copilot tool permissions, entitlement/usage logic, durable worker retries and lease loss.
- Database repository tests: tenant-scoped outbox enqueue, deduplication, payload secret rejection, row-lock claim, leases, action receipts and completion safeguards.
- API scenarios 80–84: provider connections remain pending until a real verifier is configured, Stripe setup remains blocked, consent grant/revocation, plan/usage behavior, proposal rejection, and proposal approval without implied execution.

These are added test cases, not a pass claim. Run `npm ci`, `npm test` and `npm run build`; the latest CI conclusion is the verification source of truth. If GitHub Actions again exits with `runner_id: 0` and no steps, record it as runner infrastructure failure—not as a source test pass or source test failure.

## 6. Known remaining engineering gates

- Wire the API workflow trigger/resume lifecycle to the new outbox using a transactional producer.
- Use action receipts in each side-effect boundary and pass the same idempotency key to providers.
- Build and register actual provider adapters and secret resolver; wire consent checks immediately before each delivery.
- Add a proposal executor with version checks, authorization revalidation, audit receipt and idempotency.
- Add event handler modules, persisted schedule/wait jobs, worker health/queue metrics and multi-worker integration tests.
- Add frontend UI for provider connections, consent management, Copilot proposal inbox, plan/usage overview and operational queue status.
- Replace the current JSON usage fallback with normalized persistence when database mode is enabled (already supported by the platform repository).
- Design billing only after pricing, taxes, payments, refunds and reconciliation requirements are real and approved.

**Safety rule:** Do not mark a provider verified without a successful trusted adapter check. Do not show “sent” without a provider acknowledgement. Do not treat a Copilot proposal approval as execution. Do not activate payments in this phase.


## Verification status — 6 November 2026

The latest GitHub Actions run is [42208429748](https://github.com/MuhammadAsimdeveloper/operza-growth/actions/runs/42208429748), commit `377f91879dc5e70bb71e555b7edccdb24f12b069`. Both Node 20 and Node 22 jobs ended with `runner_id: 0` and zero executed steps. The workflow therefore did not run install, build, unit, SEO or API integration checks. This is a runner-allocation failure, not evidence that the source passed or that a particular assertion failed. Re-run CI and record the actual runner output before merging.


The latest GitHub Actions run on the preceding commit again completed before runner assignment: Node 20 and Node 22 had `runner_id: 0` and zero steps. This does not prove a source test failure, but it leaves build, unit, SEO and API integration verification open. Run CI again from the final branch head and record the real outcome. No production-ready or passing-test claim is made in this guide.
