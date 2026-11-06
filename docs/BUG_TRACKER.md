# Operza — Comprehensive Bug Tracker & Vulnerability Remediation

This document catalogs identified technical defects, architectural vulnerabilities, performance bottlenecks, and their verified resolutions across all Operza subsystems.

---

## Remediation Matrix

| Defect ID | Category | Severity | Description | Remediation & Fix Strategy | Verification Test | Status |
|---|---|---|---|---|---|---|
| **BUG-001** | Multi-Tenancy | **Critical** | Potential client-side injection of `agencyId` and `locationId` in CRM entity creation/mutation endpoints (`/api/crm/:collection`). | Added explicit sanitization deleting `id`, `agencyId`, and `locationId` from incoming JSON bodies prior to spreading, binding immutable session context IDs. | `TEST 73: Cross-Tenant Injection Immunity` | **RESOLVED** |
| **BUG-002** | Queue Engine | **High** | Lack of idempotency keys in queue dispatches causing potential duplicate workflow action runs on network retry. | Implemented sliding-window `idempotencyKeys` Map with TTL and duplicate detection in `DurableWorkflowQueue.enqueue`. | `TEST 74: Durable Queue Idempotency` | **RESOLVED** |
| **BUG-003** | Queue Engine | **Medium** | Failed queue jobs lacked automatic dead-letter queue routing and jittered exponential backoff. | Implemented `calculateBackoff(attempt, baseMs, maxMs, jitter)` and automatic `moveToDeadLetterQueue` when attempts exceed `maxRetries`. | `TEST 68 & TEST 74: Queue Telemetry` | **RESOLVED** |
| **BUG-004** | Webhook Security | **High** | Webhook replay vulnerability allowing duplicate Stripe or Twilio events to re-trigger billing or automation actions. | Implemented timestamp tolerance check (`|current - timestamp| <= 300s`) and in-memory sliding event cache `webhookReplayCache`. | `TEST 75: Omnichannel Webhook Replay Protection` | **RESOLVED** |
| **BUG-005** | Telephony Webhook | **Medium** | Missing RFC HMAC-SHA1 signature verification for incoming Twilio SMS / call webhooks when `TWILIO_AUTH_TOKEN` is configured. | Implemented URL and sorted query payload HMAC-SHA1 verification using `timingSafeEqual`. | `TEST 12: Inbound Twilio Webhook` | **RESOLVED** |
| **BUG-006** | Observability | **Medium** | Missing standardized request correlation IDs across API responses, hampering multi-service tracing. | Added `x-request-id` header extraction and generation in HTTP server, propagating to all JSON responses and structured log lines. | `TEST 77: Security Headers & Correlation IDs` | **RESOLVED** |
| **BUG-007** | Client Portal | **High** | Contacts with revoked portal access (`portalAccess: false`) could still query portal summary and push course progress. | Added strict authorization checks verifying `contact.portalAccess !== false` on `/api/portal/summary/:id` and `/api/portal/courses/:id/progress`. | `TEST 76: Client Portal Access Gating` | **RESOLVED** |
| **BUG-008** | Funnel Checkout | **High** | Potential price tampering in public checkout if client submitted modified product or order bump pricing. | Enforced 100% server-side price recalculation from stored website/payment link metadata, discarding client-provided prices. | `TEST 72: Public Live Funnel Ingress` | **RESOLVED** |
| **BUG-009** | Security Headers | **Medium** | Missing default security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`) on API JSON responses. | Integrated baseline OWASP security headers directly into `sendJson` response pipeline. | `TEST 77: Security Headers` | **RESOLVED** |
| **BUG-010** | Error Disclosure | **Low** | Unhandled server exceptions exposed raw `error.message` and stack traces in production environments. | Added structured logging of stack traces while returning sanitized generic error responses in production. | `TEST 1: Health & API Gateway` | **RESOLVED** |
| **BUG-011** | Workflow Governance | **High** | Approval endpoint changed a paused execution to completed without resuming the paused node, and approval state was not action-bound in the API lifecycle. | Added persisted pending approval records, exact workflow snapshot and node index, deterministic action-hash binding, single-node grant consumption, approve/reject transitions, expiry handling, startup resume recovery, and redacted API projections. | Tests 78–79 plus workflow-engine approval lifecycle tests (CI pending) | **IMPLEMENTED — CI BLOCKED BEFORE RUNNER ASSIGNMENT; SOURCE VERIFICATION OPEN** |
| **BUG-012** | AI Governance | **High** | Copilot natural-language write intent and explicit write-tool requests could mutate CRM records or initiate workflows during chat without a separate review step. | Added a role-, tenant-capability- and agent-grant-gated tool catalog. All write/workflow/external-side-effect intents now create tenant-scoped proposals. Approve/reject routes record review only; approval returns `not_executed` until a trusted executor exists. | Tests 16–17 and 83–84 plus platform-core permission evaluations (CI and DB verification pending) | **IMPLEMENTED — EXECUTOR NOT YET BUILT; VERIFICATION OPEN** |

---

## Defect Triage & Resolution Velocity

- **Total Tracked Defects**: 12
- **Previously Resolved**: 10
- **Implemented, Awaiting Verification**: 2
- **Open Engineering Follow-ups**: proposal executor, provider adapters, outbox producer wiring and deployment DB verification
- **CI Note**: The Phase 2 branch previously saw GitHub Actions attempts exit before runner assignment; the current branch still requires a fresh executable CI run.
- **Resolution Rate**: Not recalculated until executable CI and DB verification complete
