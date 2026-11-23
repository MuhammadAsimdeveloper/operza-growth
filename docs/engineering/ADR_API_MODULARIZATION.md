# Architecture Decision Record (ADR): API Modularization & TenantTx Boundary

## Status: ACCEPTED
**Date:** 2026-11-22  
**Context:** Phase 1.1 — Foundation Re-Platform  
**Deciders:** Operza Platform Core Team  

---

## 1. Context & Problem Statement

The Operza API layer previously operated with large sections of logic consolidated within `apps/api/server.mjs` (>11,000 lines of code) alongside route files (`routes/crm.mjs`, `routes/agency.mjs`, `routes/auth.mjs`). While PostgreSQL schema migrations and Row Level Security (RLS) policies were established in earlier phases, repository data access was fragmented:
- Some endpoints directly accessed `state.records` (JSON file storage).
- Other endpoints issued ad-hoc SQL queries with varied transaction scoping.
- Some helpers manually set PostgreSQL configs without transactional boundaries.

A full framework swap (e.g., rewriting the entire server into Fastify or Express in a single phase) carries unacceptable risk of breaking legacy routes, webhooks, frontend contracts, and CI test suites (including 238 CI Postgres checks and 116 E2E tests).

---

## 2. Decision

We decide to:
1. **Maintain Native `node:http` Compatibility**:
   Keep the HTTP server and routing foundation on `node:http` request/response contracts for Phase 1.1. No framework replacement will occur until the repository and domain boundaries are fully decoupled and verified.
2. **Establish the `TenantTx` Boundary**:
   Introduce a standardized, secure `TenantTx` transactional runner in `packages/db/lib/tenant-tx.mjs`. All database interactions in domain repositories must occur through an explicit, validated `TenantTx` containing `agencyId`, `locationId`, and `actorId`.
3. **Execute One Clean Vertical Slice (Contacts Domain)**:
   Extract a dedicated `ContactsRepository` in `packages/db/lib/contacts-repository.mjs` and dedicated router in `apps/api/routes/contacts.mjs`. All contact operations (CRUD, filtering, sorting, pagination, bulk operations, atomic merge, timeline, portal access) execute through this repository via `TenantTx`.
4. **Authoritative Persistence (Zero Dual-Truth)**:
   When `pgPool` is present, PostgreSQL is the sole authoritative persistence layer. JSON fallback/mirroring is prohibited for database-backed environments and strictly reserved for zero-config local development without a database (`!pgPool`).
5. **Preserve Wire Compatibility**:
   Maintain 100% backward compatibility for all existing API routes (`GET/POST/PUT/DELETE /api/crm/contacts`, `/api/crm/contacts/bulk-tag`, etc.) and response payloads.

---

## 3. Alternatives Considered

### Option A: Complete Immediate Rewrite to Fastify
- *Pros*: Built-in Zod schema validation, unified plugin architecture.
- *Cons*: High blast radius; breaks hundreds of existing e2e test cases and route bindings; high risk of regressions across Webhook ingress and Auth sessions.
- *Reason for Rejection*: Violates the phased stability guarantee.

### Option B: Continue Ad-Hoc SQL in `server.mjs`
- *Pros*: No refactoring required.
- *Cons*: Violates the Master Plan; leaves code brittle; maintains coupling to the JSON state blob; risks cross-tenant data leakage if RLS is not systematically set.
- *Reason for Rejection*: Unacceptable architecture and security debt.

### Option C: Incremental Modularization with TenantTx Boundary (Selected)
- *Pros*: Provides strict tenant isolation and RLS enforcement immediately; isolates domain logic; leaves HTTP transport layer intact and verified; allows incremental migration domain-by-domain.
- *Cons*: Requires maintaining coexistence between newly extracted repositories and legacy handlers until all domains are migrated.

---

## 4. Consequences & Guarantees

1. **Security**:
   - Every contact query is executed with `app.agency_id`, `app.location_id`, and `app.user_id` set within the transaction.
   - Forced RLS prevents cross-tenant access at the PostgreSQL storage engine level.
2. **Maintainability**:
   - `ContactsRepository` is cleanly decoupled from HTTP concerns (headers, request parsing, response formatting) and can be tested in isolation.
3. **Reliability**:
   - Transactions strictly commit or roll back with automatic client release, preventing connection pool exhaustion or session setting leakage.
