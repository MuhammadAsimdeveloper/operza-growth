# Operza Growth — API Architecture Map

## 1. Executive Summary & Purpose

This document provides a comprehensive structural mapping of the Operza Growth API architecture as established during Phase 1.1 (Foundation Re-Platform). It details the end-to-end HTTP request lifecycle, actor context resolution, connection pooling, Row Level Security (RLS) parameter propagation, and the isolation boundary between HTTP handlers and background worker execution.

---

## 2. HTTP Request Lifecycle & Boundary Flow

```
                      +---------------------------------------+
                      |       Inbound HTTP Request            |
                      |   (Method, Path, Headers, Body)       |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |        HTTP Server Ingress            |
                      |    (node:http / apps/api/server.mjs)  |
                      |   - Request ID allocation             |
                      |   - CORS allowlist enforcement        |
                      |   - Static route pre-dispatch         |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |     Authentication & Actor Resolution |
                      |   - Bearer API Key (op_live_*)        |
                      |     OR Session Cookie (auth_sessions) |
                      |   - Resolves: actor { user, agency,   |
                      |     activeLocation, scopes }          |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |         Route Scope Verification      |
                      |   - checkApiKeyScope(actor, scope)    |
                      |   - Invariant: 403 on missing scope   |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |          Domain Route Handlers        |
                      |   - apps/api/routes/contacts.mjs      |
                      |   - apps/api/routes/opportunities.mjs |
                      |   - apps/api/routes/crm.mjs           |
                      |   - apps/api/routes/auth.mjs          |
                      |   - apps/api/routes/agency.mjs        |
                      |   - apps/api/routes/system.mjs        |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |      TenantTx Repository Boundary     |
                      |    (packages/db/lib/tenant-tx.mjs)    |
                      |   1. Lease dedicated pg.PoolClient    |
                      |   2. BEGIN explicit transaction       |
                      |   3. SET LOCAL app.agency_id = ...    |
                      |      SET LOCAL app.location_id = ...  |
                      |      SET LOCAL app.user_id = ...      |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |      Modular Domain Repositories      |
                      |   (e.g., ContactsRepository)          |
                      |   - Typed CRUD operations             |
                      |   - RLS enforced by PostgreSQL engine |
                      |   - Defense-in-depth SQL parameters   |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |       Transaction Finalization        |
                      |   - COMMIT on success                 |
                      |   - ROLLBACK on failure               |
                      |   - Release client in finally block   |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |       JSON Response Outgress          |
                      |   (sendJson / RFC 7807 problem+json)  |
                      +---------------------------------------+
```

---

## 3. Actor Context Resolution & Multi-Tenancy Invariants

Every non-public HTTP request entering Operza undergoes deterministic actor resolution:

1. **Authentication Mode**:
   - **Session-Based**: Resolves `sessionToken` from `operza_session` cookie against the `auth_sessions` table or state session store. Resolves `user`, default/active `agency`, and active `location`.
   - **API Key-Based**: Resolves `Authorization: Bearer op_live_<id>` against active API keys. Hashes and checks key validity, resolving the associated `agency_id`, restricted `location_id`, and permitted scopes.
2. **Context Integrity Invariant**:
   - Every tenant transaction requires a non-null, validated tuple:
     $$\mathcal{C} = \langle \text{agencyId}, \text{locationId}, \text{actorId} \rangle$$
   - Missing or blank identifiers immediately fail-closed with HTTP `401 Unauthorized` or `400 Bad Request` prior to database execution.
   - Client-provided IDs in the request body (e.g. attempting to supply another `agencyId` or `locationId`) are stripped at the router boundary to prevent spoofing or horizontal cross-tenant access.

---

## 4. Connection Pooling & Database RLS Propagation

Operza utilizes a managed `pg.Pool` with strict least-privilege role boundaries (`operza_app` for HTTP queries, `operza_worker` for outbox and background tasks):

1. **Pool Acquisition**:
   - A client is leased exclusively from `pg.Pool` for the duration of a business transaction.
   - Unpooled or ambient database calls without tenant context are forbidden in domain repositories.
2. **PostgreSQL Session Context Setting**:
   - The settings are applied with `is_local = true` (`SET LOCAL`):
     ```sql
     SELECT set_config('app.agency_id', $1, true),
            set_config('app.location_id', $2, true),
            set_config('app.user_id', $3, true);
     ```
   - Because `is_local = true` is enforced, the settings automatically evaporate when the transaction commits or rolls back, preventing connection poisoning in the pool.
3. **Database RLS Enforcement**:
   - All tenant tables (`location_records`, `opportunities`, `appointments`, `calendars`, etc.) have `FORCE ROW LEVEL SECURITY` enabled.
   - The database engine denies reads and writes to any row where `agency_id != current_setting('app.agency_id')` or `location_id != current_setting('app.location_id')`.

---

## 5. HTTP Handler vs. Background Worker Boundary

```
+----------------------------------------------------------------------------------+
|                            OPERZA PROCESS BOUNDARIES                             |
+----------------------------------------------------------------------------------+
|  HTTP Ingress (apps/api)                      Worker Ingress (apps/worker)        |
|  - Role: operza_app                           - Role: operza_worker               |
|  - RLS Scope: Agency + Location               - RLS Scope: Tenant lease + Worker |
|  - Ephemeral Request Lifetime                 - Persistent outbox processing     |
|  - Synchronous client response                - Asynchronous execution / retry   |
|                                                                                  |
|                \                                     /                           |
|                 \   Transactional Outbox Pattern    /                            |
|                  v                                 v                             |
|          +--------------------------------------------------+                    |
|          |         Table: workflow_outbox                   |                    |
|          |   - Enqueued synchronously in HTTP TenantTx      |                    |
|          |   - Polled & claimed via atomic lease in worker  |                    |
|          +--------------------------------------------------+                    |
+----------------------------------------------------------------------------------+
```

1. **Transactional Outbox Decoupling**:
   - Domain mutations in HTTP handlers (e.g., contact creation, opportunity stage change) do not invoke synchronous third-party HTTP calls or long-running workflows.
   - Events are written to `workflow_outbox` within the **same** `TenantTx` that saves the domain record.
   - If the business transaction fails, the outbox event is rolled back atomically; phantom events cannot escape.
2. **Worker Independence**:
   - Workers claim jobs via fenced database leases (`worker_heartbeats`, `workflow_resume_leases`, `workflow_action_receipts`).
   - Workers set their own execution context through verified outbox payload records.

---

## 6. Modular Domain Architecture Evolution

Phase 1.1 through 1.3 execute the modular breakdown of monolithic route handling:

| Domain | Status | Target Module | Repository |
|---|---|---|---|
| **Contacts** | **Fully Modularized & Certified** | `apps/api/routes/contacts.mjs` | `ContactsRepository` with `TenantTx` (CRUD, merge, timeline, bulkTag, portal-access, import, export-csv) |
| **Opportunities** | **Fully Modularized & Certified** | `apps/api/routes/opportunities.mjs` | `OpportunitiesRepository` with `TenantTx` (CRUD, stage updates, summary, sort allowlist) |
| **Calendars & Appointments** | **Fully Modularized & Certified** | `apps/api/routes/scheduling.mjs` | `SchedulingRepository` with `TenantTx` (Calendars CRUD, Appointments CRUD, GiST Concurrency, Public Booking, 2-Way Sync) |
| **Workflows & Executions** | **Fully Modularized & Certified** | `apps/api/routes/workflows.mjs` | `WorkflowsRepository` with `TenantTx` (Definitions CRUD, Executions, Steps, Approvals, Tick, Single-Node Testing) |
| **Pipelines & Stages** | **Fully Modularized & Certified** | `apps/api/routes/pipelines.mjs` | `PipelinesRepository` with `TenantTx` (Pipelines CRUD, normalized `pipeline_stages` sync, sort allowlist) |
| **Funnels & Websites** | **Fully Modularized & Certified** | `apps/api/routes/funnels.mjs` | `FunnelsRepository` with `TenantTx` (`location_records` websites/funnels CRUD, public visit/opt-in, 1-click upsell) |
| **Integrations & Secrets** | Completed (Phase 0) | `packages/platform-core/secret-vault.mjs` | `SecretVaultRepository` |
