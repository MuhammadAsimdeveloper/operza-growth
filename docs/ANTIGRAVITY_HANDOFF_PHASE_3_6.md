# Antigravity Handoff — Operza Platform Foundation, Phases 3–6

**Start branch:** `feat/phase-3-6-platform-foundation`  
**Do not start from main. Do not merge or deploy until verification passes.**  
**Architecture and implementation reference:** [Phase 3–6 Platform Foundation](PHASE_3_6_PLATFORM_FOUNDATION.md)  
**Product roadmap:** [Unified Operza + Atlas Plan](UNIFIED_OPERZA_ATLAS_PLAN.md)

## Mission

Continue Operza Growth from its current backend foundation. Complete the product-facing UI and remaining safe integration work for provider onboarding, consent management, Copilot proposal review, usage/entitlements and durable automation operations.

The aim is a working, inspectable business platform—not a visual mockup with fake delivery states.

## 0. Repository onboarding and verification first

**Current CI state:** Run [42208533570](https://github.com/MuhammadAsimdeveloper/operza-growth/actions/runs/42208533570) for the current branch ended before runner assignment. Both Node 20 and Node 22 jobs report `runner_id: 0` and zero steps. This is not a passing run and not a source-code failure result. Re-run after checkout and capture actual build/test output. Re-run CI from the current branch head and capture actual build/test output.

1. Checkout branch `feat/phase-3-6-platform-foundation`.
2. Inspect the current diff against main and read:
   - `docs/PHASE_3_6_PLATFORM_FOUNDATION.md`
   - `docs/PHASE_2_DURABLE_APPROVALS.md`
   - `docs/UNIFIED_OPERZA_ATLAS_PLAN.md`
   - `docs/ATLAS_CONTROL_CENTER_AND_AUTOMATION.md`
3. Run:
   - `npm ci`
   - `npm test`
   - `npm run build`
4. Record exact results. Do not say tests passed when GitHub Actions exits before runner assignment or when no steps have executed.
5. Repair regressions before building UI. Keep the feature branch isolated.

If using a design reference, preserve the existing Atlas Control Center design language from the supplied Figma file:
https://www.figma.com/design/PrrVxX6q5KIUtxlXLHSala/Atlas-Desktop-Control-Center

## 1. Build the provider connections experience

Use the existing API client methods under `api.platform` in `apps/web/src/lib/api.ts`.

Create an Integrations / Connections experience with:
- Fixed provider catalog and capability labels.
- Connect wizard for provider type, display name, and server-side secret reference.
- Status chips: Pending verification, Verified, Degraded, Revoked.
- Connection details and revoke confirmation.
- Clear explanation that the API verification route currently returns `PROVIDER_ADAPTER_UNAVAILABLE`.

Security acceptance criteria:
- Never collect an API secret into a React field and send it to the browser-facing API.
- Never show or echo the secret reference returned by a server.
- Do not add a fake Verify button that changes status locally.
- Do not display “Connected”, “Verified”, “Sent”, or “Delivered” unless the server/provider state confirms it.
- Stripe/payment setup remains unavailable and visibly disabled.

The backend connection record stores a reference only. A real server-side secret resolver and provider adapter are a separate backend task.

## 2. Build the consent ledger

Use `api.platform.listConsents`, `recordConsent`, and `revokeConsent`.

Create a contact-level consent view that shows:
- Channel: email, SMS, WhatsApp.
- Purpose: transactional, marketing, appointment, review request.
- Granted/revoked state.
- Source, proof reference and capture time.
- Explicit opt-out action that appends a revocation event rather than deleting history.

Acceptance criteria:
- Scope every view and mutation to the active tenant/location.
- Do not infer consent from the existence of an email address or phone number.
- Display missing/expired/revoked consent as not authorized.
- Keep UI copy clear that the policy module is present but not yet called by a live provider adapter.

## 3. Build the Copilot proposal inbox

Use:
- `api.copilot.getProposals()`
- `api.copilot.approveProposal(id)`
- `api.copilot.rejectProposal(id)`

Create an inbox with filters for Pending, Approved, Rejected; proposal type/risk; requester; and timestamp. Show proposed fields in a safe, readable diff.

Approval UX must distinguish three states:
1. Proposal drafted.
2. Human decision recorded.
3. Mutation actually executed.

The current approve endpoint returns `execution.status = not_executed`. Show that exact meaning. Do not change the UI to display “Completed”, “Created”, “Sent” or “Executed” after approval. The proposal executor does not yet exist.

Before implementing an executor, design it as a separate service that:
- Revalidates actor role, tenant capability and agent grant at execution time.
- Revalidates the target record and expected version.
- Applies one allow-listed action only.
- Uses an action receipt/idempotency key.
- Writes a durable audit record and an explicit outcome.
- Requires a second authorization check for external side effects.
- Never accepts arbitrary code or an arbitrary URL from proposal params.

## 4. Build the commercial usage/entitlements surface

Use:
- `api.platform.getPlans()`
- `api.platform.getEntitlements()`
- `api.platform.getUsage()`

Build a Plan & Usage page that displays:
- Current plan and included capabilities.
- Usage against limits for workflow runs and Copilot requests.
- Feature availability and disabled feature explanations.
- Billing state only if a real billing source is connected.

Do not invent pricing or display estimates as actual prices. All current plans return `pricing: null`. Payments, live messaging and marketplace entitlements remain disabled. Do not add a fake checkout or subscription activation.

**Approval table note:** Migration 008 creates a normalized `workflow_approvals` table, but the Phase 2 API approval routes are not yet writing to it. Implement that cutover separately, with transactional decisions and compare-and-set semantics.

## 5. Finish the durable outbox integration

The repository has:
- Migration 008: outbox, action receipts, approvals, providers, consent, entitlement and usage tables.
- Migration 009: Copilot proposals.
- `packages/db/lib/outbox-repository.mjs`
- `packages/db/lib/platform-repository.mjs`
- `packages/platform-core/src/durable-worker.mjs`
- `apps/api/worker.mjs`

Remaining engineering tasks:
1. Add a transactional workflow trigger producer that writes outbox events with deterministic idempotency keys.
2. Route appropriate workflow resume and connector actions through outbox events.
3. Create a trusted local handler module with an explicit allow-list of event names. Unknown handlers must remain dead-lettered.
4. Ensure the worker uses a separate `WORKER_DATABASE_URL` for the `operza_worker` role.
5. Apply migration 008, then run `packages/db/operations/provision_worker_role.sql`, then apply/verify migration 009 as appropriate for the deployment procedure.
6. Verify lease expiry, heartbeats, retries, dead-letter behavior, process restart and duplicate event handling with two workers.
7. Use action receipts at every side-effect boundary. A database action receipt alone cannot guarantee exactly-once external delivery; the provider's idempotency API must also be used.

Do not enqueue real sends until provider verification, recipient-level consent and an adapter are in place. Do not create a generic HTTP node or execute user-authored code.

## 6. Implement real provider adapters only with verified server config

For each provider adapter:
- Credentials are resolved server-side from a secret reference.
- Provider verification checks the expected account and required scopes.
- Adapter supports provider-native idempotency.
- Delivery results distinguish queued, accepted, delivered, bounced, failed and unknown as supported.
- Webhook signatures and replay protection are verified.
- Recipient consent is checked immediately before dispatch.
- Tests use fake/test accounts or provider contract fixtures; do not fabricate live success.

Do not enable payment providers until webhook authenticity, reconciliation, refunds, idempotency and financial controls have been designed and tested.

## 7. Quality gates

Required before declaring this continuation complete:
- Node 20 and Node 22 CI.
- `npm test` and `npm run build` pass.
- New API and UI tests cover success, permission denial, tenant isolation, expired/missing consent, duplicate outbox messages, lease loss, pending provider verification and proposal approval that is not execution.
- Keyboard accessibility, focus management, responsive layouts and error/loading/empty states.
- No secrets in browser bundles, logs, events, proposals or screenshots.
- Update README, API documentation, bug tracker, roadmap and repair log.
- Attach the exact GitHub Actions run and commit SHA to the handoff.
- Do not merge to main automatically.

## 8. Handoff output

Return:
1. Pages/components added and their routes.
2. API endpoints used.
3. Migrations applied (or explicitly not applied).
4. Provider adapters and worker handlers implemented, if any.
5. Tests run with exact pass/fail output and CI links.
6. Remaining blockers and whether any environment variables/credentials are required.
7. A final list of changed files and commit SHA.

**Non-negotiable:** never turn a placeholder into a claim of a real integration. If an adapter, credential, webhook, worker process or payment control does not exist, show it as pending/disabled and state the blocker.
