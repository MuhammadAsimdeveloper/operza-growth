# OPERZA GROWTH — NEXT PHASE STRATEGIC ROADMAP

> **Document Type:** Production Engineering & Architectural Implementation Roadmap  
> **Platform Version:** Operza Unified Business Operating System v2.0  
> **Destination Branch:** `feat/operza-unified-atlas-automation` &rarr; Production Release Prep  
> **Base Foundation:** Phase 3–6 Platform Foundation Completed (261/261 tests passing)  
> **Target Horizon:** Q1–Q2 2027

---

## 1. Roadmap Overview & Strategic Priorities

With the primary Operza architecture stabilized, Phase 3–6 UI surfaces operational, and durable action-bound approvals, outbox event generation, and the Flagship Business Journey fully verified, the platform is ready for physical adapter wiring and production scaling.

```
+---------------------------------------------------------------------------------------+
|                              ROADMAP PHASING HORIZON                                  |
|                                                                                       |
|  [PHASE 7] Real Provider Adapters & Encrypted Secret Vault (Fail-Closed to Live)      |
|      ↓                                                                                |
|  [PHASE 8] Governed Proposal Executor for Copilot Mutations (Inbox to Execution)      |
|      ↓                                                                                |
|  [PHASE 9] Commercial Plan Pricing & Live Stripe Billing Engine                       |
|      ↓                                                                                |
|  [PHASE 10] Distributed Multi-Worker Deployment & High-Throughput Redis Outbox        |
|      ↓                                                                                |
|  [PHASE 11] Hosted Multi-Tenant Deployment & Enterprise CI/CD Hardening               |
+---------------------------------------------------------------------------------------+
```

---

## 2. Phase 7: Real External Provider Adapters & Secret Vault

### Objective
Transition provider connections from fail-closed simulation (`PROVIDER_ADAPTER_UNAVAILABLE`) to authenticated, real-world external delivery while maintaining strict zero-secret browser exposure.

### Key Milestones
1. **Encrypted Secret Resolver Interface:**
   - Define `@operza/platform-core` secret provider contract: `resolveSecret(agencyId, secretRef) -> Promise<string>`.
   - Provide reference implementations for:
     - Local encrypted AES-256-GCM vault with master key stored in environment.
     - Cloud KMS (AWS Secrets Manager, GCP Secret Manager, or HashiCorp Vault).
2. **First-Party Production Adapters:**
   - **Email:** Resend API adapter and SendGrid v3 adapter supporting transactional and marketing tags.
   - **SMS:** Twilio REST adapter with A2P 10DLC Campaign SID attachment and rate-limiting enforcement.
   - **WhatsApp:** Meta Graph API v21.0 adapter supporting template messages and interactive reply buttons.
   - **Payments:** Stripe API adapter for customer tokenization, PaymentIntents, and webhook signing verification.
3. **Connection Verification Engine:**
   - Replace fail-closed verification stub with live provider handshake (e.g. calling `GET /v1/account` or checking API token scopes).
   - Transition status from `pending` &rarr; `verified` or `error` with structured error taxonomy (`INVALID_API_KEY`, `RATE_LIMITED`, `INSUFFICIENT_PERMISSIONS`).

---

## 3. Phase 8: Governed Proposal Executor for AI Copilot

### Objective
Bridge the gap between human approval in `/copilot-inbox` and actual CRM/workflow data mutation, moving from `execution.status: 'not_executed'` to audited, transactional execution.

### Key Milestones
1. **Authoritative Proposal Executor:**
   - Implement `executeApprovedProposal(proposalId, actor)` in `@operza/platform-core`.
   - Verify immutable human decision record before initiating mutation.
   - Re-check tenant isolation bounds (`agencyId`, `locationId`) and entity existence at moment of execution.
2. **Transactional Mutation Handlers:**
   - Dedicated handlers for CRM mutations: `create_contact`, `update_contact_tags`, `move_opportunity_stage`, `create_task`.
   - Safe rollback on execution failure with structured failure audit logs.
3. **Execution Receipt Generation:**
   - Emit unique action receipt (`action_receipts` table in PostgreSQL migration 008) linking human approver, proposal ID, executed timestamp, and before/after entity state diff.
   - Broadcast `copilot.proposal.executed` WebSocket event to update UI in real-time.

---

## 4. Phase 9: Commercial Pricing & Stripe Subscription Billing

### Objective
Activate real subscription management, multi-tier pricing plans, and metered billing overages.

### Key Milestones
1. **Commercial Tier Definition:**
   - Define public subscription tiers (Starter, Growth, Scale, Enterprise) with transparent pricing in USD.
   - Maintain beta and development tiers (`pricing: null`) for self-hosted and staging environments.
2. **Stripe Billing Integration:**
   - Synchronize Stripe Customers, Subscriptions, and Invoices with tenant account records.
   - Webhook processing for `customer.subscription.updated` and `invoice.payment_failed` with automatic entitlement suspension.
3. **Usage Metering Enforcement:**
   - Real-time entitlement enforcement gating operations when usage caps are reached (e.g. contact limits or monthly Copilot tokens).
   - Automated overage billing event generation via PostgreSQL outbox.

---

## 5. Phase 10: Multi-Worker Distributed Outbox & Redis Queue

### Objective
Scale asynchronous workflow execution and event processing across distributed compute nodes without double-execution risks.

### Key Milestones
1. **Standalone Outbox Worker Binary:**
   - Package `bin/operza-worker.mjs` as a production-grade daemon with graceful shutdown signals (`SIGTERM`, `SIGINT`).
   - Role-restricted database connection using the non-privileged `operza_worker` database user.
2. **PostgreSQL SKIP LOCKED Multi-Worker Leases:**
   - Verify concurrent outbox processing across 5+ simultaneous worker processes.
   - Ensure zero duplicate claims or race conditions via row-level locks and monotonic lease renewals.
3. **Redis Cluster Outbox Fallback:**
   - High-throughput Redis Streams integration for high-frequency webhook ingestion and sub-millisecond task queuing.
   - Automatic dead-letter queue (DLQ) inspection and replay CLI.

---

## 6. Phase 11: Production Hosting & Enterprise CI/CD Pipeline

### Objective
Establish continuous verification and 1-click cloud deployment pipelines.

### Key Milestones
1. **Dedicated GitHub Actions CI Runner:**
   - Configure self-hosted or dedicated GitHub Actions runners to execute full test suite (85 E2E scenarios, 26 platform-core, 35 workflow-engine, 9 DB, 106 SEO).
   - Containerized PostgreSQL and Redis service containers in CI matrix for true PostgreSQL RLS verification on every PR.
2. **Multi-Region Cloud Deployment:**
   - Production Docker image build optimization (`Dockerfile` multi-stage build, non-root user, minimal Alpine/Debian base).
   - Kubernetes Helm charts and Docker Compose production recipes with automated zero-downtime rolling updates.
   - Dynamic SSL termination and tenant custom domain routing via Caddy / Traefik reverse proxy.

---

## 7. Immediate Next Actions

1. Review and merge `feat/operza-unified-atlas-automation` into staging branch via formal PR review (referencing PR template).
2. Apply migrations 001–009 in dedicated PostgreSQL staging database.
3. Implement Phase 7 AWS KMS / AES-256 secret resolver interface.
4. Wire Resend and Twilio provider adapters with live test sandboxes.
