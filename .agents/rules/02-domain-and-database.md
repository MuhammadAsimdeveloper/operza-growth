# Rule 02: Domain Model and Database Safety

## 1. Single Source of Truth for Core Systems
Every major capability in Operza must have exactly **one** authoritative implementation:
- **Identity & Authentication:** Single user and session model.
- **Tenant Hierarchy:** Canonical Operza agency and location model (`agencies`, `locations`, `users`, `memberships`).
- **CRM & Customer Records:** Canonical contacts, leads, companies, pipeline deals, custom fields.
- **Workflow Automation:** One workflow graph schema, node registry, and execution engine.
- **Action Governance:** One typed action registry, authorization checker, and human approval queue.
- **Background Execution:** Single worker process and Redis/BullMQ/PostgreSQL job queue.
- **Provider Connectivity:** One provider connection registry, credential vault, and adapter fabric.
- **AI Tool Runtime:** Single tool execution gateway with capability checks and parameter validation.
- **Customer Inbox:** Unified multichannel conversation stream (SMS, email, voice, chat).
- **Billing & Subscriptions:** Single entitlement, plan, and credit accounting ledger.
- **Audit Trails:** Immutable, append-only operational audit log.

Before creating or migrating any module, check existing implementations in both repositories to eliminate duplicate domain concepts.

## 2. Database Governance and Safety
Operza uses **PostgreSQL** with Row-Level Security (RLS) as the canonical persistent store:
1. **Single Migration History:**
   - All migrations live in Operza (`packages/db/migrations`).
   - Never copy Atlas SQL migrations wholesale into Operza.
   - Never alter or delete an already-applied migration file.
   - All future schema changes must be forward-only, idempotent migrations with safe rollback/down plans.
2. **Strict Multi-Tenancy & Row-Level Security (RLS):**
   - Every tenant-scoped table must include `tenant_id` (or `agency_id`) and `location_id`.
   - Every tenant-scoped query must enforce tenant context.
   - RLS policies must strictly prevent cross-tenant reads, writes, and updates.
   - Verify that missing tenant context fails closed (throws an authorization exception, returns zero records).
3. **Privilege Separation:**
   - Maintain separate database roles: Migration owner (DDL permissions), Application API (DML restricted to tenant RLS), and Background Worker.
   - Never use superuser roles for application runtime connections.
   - Never expose raw database credentials or connection strings to client-side code.
4. **Transactions and Concurrency:**
   - Multi-step writes (e.g., executing a workflow step + debiting credits + writing audit log) must occur in an explicit database transaction.
   - Use optimistic concurrency or advisory locks where race conditions could occur.
   - Write tests for transaction rollback upon step failure.
