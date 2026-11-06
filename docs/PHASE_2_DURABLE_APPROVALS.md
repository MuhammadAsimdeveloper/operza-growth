# Phase 2 — Durable workflow approvals

**Implementation branch:** `feat/phase-2-durable-approvals`  
**Status:** Implemented in source; CI verification blocked so far because GitHub Actions jobs exited before runner assignment. A subsequent run is queued.  
**Scope:** Persisted action-bound approval and continuation of one workflow execution.

## Delivered behavior

1. A live workflow pauses before an action that is explicitly marked `requiresApproval` or whose action catalog requires a human decision.
2. The server saves a private workflow snapshot, version, node index and execution identity.
3. The approval record binds tenant, location, workflow, execution, node, requester, deterministic action hash, expiry and request timestamp.
4. The dashboard can list pending approvals and approve or reject one request.
5. Self-approval, cross-tenant/workspace approval, expired requests, stale action hashes, repeated decisions and action/node mismatch are rejected.
6. Approval is consumed for the one node only. The same saved execution resumes at that node and then proceeds to later nodes.
7. Rejection or expiry marks the run failed without executing the paused action.
8. If the process stops after the approval decision is saved but before resume begins, startup recovery continues runs persisted as `resuming`.
9. API responses expose an allow-listed execution projection; private workflow snapshots, raw payloads, actor IDs, approval evidence and action hashes are not returned to the browser.

## Persistence model

Approvals live in `state.workflowApprovals` next to `state.workflowExecutions`. The current server's `saveState()` pipeline persists the complete state envelope using atomic local JSON writes and, when configured, the PostgreSQL `operza_app_state` snapshot.

This is durable for a single application process and survives restarts. It is **not** a normalized approval table with database-level compare-and-set constraints. Multiple API instances sharing one state snapshot are not safe to use as a distributed worker system.

## API

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/workflows/approvals` | Pending approvals for the active tenant and location |
| GET | `/api/workflows/runs` | Redacted execution history |
| POST | `/api/workflows/runs/:id/approve` | Approve the pending action and resume from the pinned node |
| POST | `/api/workflows/runs/:id/reject` | Reject the pending action; it is not executed |

The approval request expires after 15 minutes by default. Expiry cleanup runs when the approval inbox or workflow run list is read and before a decision is applied.

## Tests added

- Approval contract: bounded expiry, requester/approver separation, tenant/location enforcement, action mismatch, single-use decisions and expired requests.
- Engine: a grant for one node cannot authorize a later node.
- API end-to-end: pending approval appears in the inbox, approved internal action resumes and later steps run, duplicate approval is rejected without creating another task, and rejected action never runs.

These are test cases added to the repository, not a test-pass claim. The GitHub Actions result is the verification source of truth.

## Remaining work

- Normalize approval and execution records into tenant-scoped relational tables.
- Use a transactional outbox/action receipt and compare-and-set transition for multiple instances.
- Implement actual email/SMS/review providers and enforce provider-side idempotency using the supplied action hash.
- Record per-attempt history, leases, retries, provider acknowledgements and delivery status.
- Add richer UI inspector fields for redacted attempts and provider lifecycle once those fields exist.

**No live provider or payment path is activated by this phase.** A human approval does not itself mean an email, SMS, review request or payment was sent.


## Verification status — 6 November 2026

The first GitHub Actions run and its rerun completed as failures before any runner was assigned (`runner_id: 0`, zero job steps, no downloadable job logs). Those outcomes do not demonstrate a source-code test failure, but they also do not verify the source. A fresh run for the timeline fix is queued. Do not treat the unit or E2E cases as passed until a runner executes them and reports successful conclusions.
