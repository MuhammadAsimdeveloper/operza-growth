# Atlas Capabilities Integration Matrix

**Destination:** Operza Growth (`feat/operza-unified-atlas-automation`)  
**Reference:** Atlas Repository (`Atlas-` @ `b68b534`)  
**Status Date:** 6 November 2026  

---

## Capability Classification Matrix

| Domain | Atlas Capability | Operza Target | Current Status | Integration Strategy / Notes |
|---|---|---|---|---|
| **CRM** | Advanced Contact Management | `apps/api` & `apps/web/src/pages/Contacts.tsx` | **Already Implemented in Operza** | Multi-tenant contacts with custom fields, tags, smart lists, and bulk actions. |
| **CRM** | Duplicate Detection & Merge | `apps/web/src/pages/Contacts.tsx` / `apps/api` | **Already Implemented in Operza** | E2E tested contact merge API (`/api/crm/contacts/merge`) and UI modal. |
| **CRM** | Activity Timelines | `apps/web/src/pages/ContactDetail.tsx` | **Already Implemented in Operza** | Contact activity history, notes, and communications timeline. |
| **CRM** | Companies & Account Relationships | `apps/api` & `packages/shared` | **Requires Adaptation** | Extend Operza contact schema with structured company association, parent/subsidiary tags, and domain deduplication. |
| **Workflows** | Action Fabric & Hash Binding | `@operza/workflow-engine` | **Already Implemented in Operza** | Deterministic SHA-256 action hash binding tenant, execution, node, and input. |
| **Workflows** | Action-Bound Approval Lifecycle | `@operza/workflow-engine` & `apps/api` | **Already Implemented in Operza** | Action-bound approval requests, 15-minute expiry, single-node grant consumption, resume-from-paused-node. |
| **Workflows** | Safe Data Mapping | `@operza/workflow-engine` | **Partially Implemented** | Integrate Atlas `safe-data-mapping.mjs` path traversal into Operza workflow transformation nodes without `eval()`. |
| **Workflows** | In-Memory Node Transforms | `@operza/workflow-engine` | **Partially Implemented** | Clean-room implementations of loop batching, array splitting, filtering, sorting, and field editing. |
| **AI / Copilot** | Role & Tenant Tool Gating | `@operza/platform-core` | **Already Implemented in Operza** | Intersection of actor role, tenant capability, and agent grant. Viewers cannot run write tools. |
| **AI / Copilot** | Proposal-Only Mutations | `@operza/platform-core` & `apps/api` | **Already Implemented in Operza** | Natural language write intents create tenant-scoped proposals; Copilot chat never executes directly. |
| **AI / Copilot** | Proposal Review Inbox | `apps/web/src/pages/CopilotInbox.tsx` | **Already Implemented in Operza** | 3-stage lifecycle UI (Drafted, Decision Recorded, Execution Gated `not_executed`). |
| **AI / Copilot** | Proposal Executor Service | `packages/platform-core` | **Partially Implemented** | Backend executor contract designed with optimistic locking and idempotency. |
| **Platform** | Provider Catalog & Secret Refs | `@operza/platform-core` & `apps/web` | **Already Implemented in Operza** | Reference-only server credentials, public redaction, fail-closed verification. |
| **Platform** | Consent Evidence Ledger | `@operza/platform-core` & `apps/web` | **Already Implemented in Operza** | Scoped recipient channel/purpose authorization, append-only revocation ledger. |
| **Platform** | Commercial Entitlements & Usage | `@operza/platform-core` & `apps/web` | **Already Implemented in Operza** | Unpriced plan catalogs (`pricing: null`), monthly quota tracking for workflows and Copilot. |
| **Operations** | Transactional Outbox & Leases | `packages/db` & `packages/platform-core` | **Already Implemented in Operza** | Outbox repository with `SKIP LOCKED`, renewable leases, bounded concurrency, dead-letter disposition. |
| **Operations** | Outbox Producers & Handlers | `packages/platform-core` | **Already Implemented in Operza** | Transactional workflow trigger/resume producers and allow-listed trusted handlers. |
| **Infrastructure** | Restricted Worker DB Role | `packages/db/operations/provision_worker_role.sql` | **Requires Adaptation** | Provisioned dedicated `operza_worker` role with minimal grants on outbox and action receipts. |
| **External** | Live Mail/SMS Send Adapters | `packages/integrations` | **Blocked by External Dependency** | Requires live production API credentials, carrier registration, and DNS records. Fails closed safely. |
| **External** | Live Payment / Stripe Processing | `apps/api` | **Blocked by External Dependency** | Disabled across all plans until live financial controls and webhook reconciliation are verified. |
