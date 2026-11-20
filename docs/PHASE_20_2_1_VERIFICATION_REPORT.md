# OPERZA GROWTH — PHASE 20.2.1 VERIFICATION & AUDIT REPORT
## Strict Location-Boundary Repair & Security Regression

**Repository:** `MuhammadAsimdeveloper/operza-growth`  
**Branch:** `feat/operza-agency-launch-readiness`  
**Commit Range:** `7389191db431a181f6e1c8b6bcf36e80dace56cb` -> HEAD  
**Date:** November 20, 2026  
**Auditor:** Independent Release Verification Engineer (Antigravity Agent)

---

## Executive Summary

Phase 20.2.1 completed strict location-boundary enforcement and residual defect closure. The audit verified and resolved:
1. **P0 Location-Boundary Hardening in PostgreSQL Approval Expiration:**
   - Migration `026_migration_owner_and_approval_expiration_hardening.sql` contained a conditional location check (`IF v_curr_location IS NOT NULL AND p_location_id != v_curr_location::uuid`), which permitted an actor with `NULL` or empty session location context to expire approvals across other locations within the same agency.
   - Preserving the immutability of migrations 001–026, forward migration `027_strict_location_boundary_repair.sql` replaces `expire_tenant_workflow_approvals(p_agency_id, p_location_id)` with strict mandatory validation:
     - Rejects `NULL` `p_agency_id` or `p_location_id` parameters (`ARGUMENT_REQUIRED`).
     - Mandates non-null and non-empty `app.agency_id` and `app.location_id` session context (`TENANT_CONTEXT_MISMATCH`).
     - Rejects malformed UUID context safely (`TENANT_CONTEXT_MISMATCH`).
     - Enforces `IS DISTINCT FROM` comparison between session context and supplied parameters, failing closed on any discrepancy.
     - Scopes locking queries and updates strictly by composite key `(agency_id, location_id, id)`.
2. **P0 Adversarial Regression Test Suite:**
   - Extended `least-privilege-rls.test.mjs` with 10 adversarial regression scenarios under unprivileged `operza_app` role.
   - Seeded expired approvals across multiple locations (`locationA1`, `locationA2`) in the same tenant agency (`tenantA`).
   - Verified that missing context, empty string context, NULL arguments, and cross-location calls fail closed.
   - Verified that prior to, during, and after failed attempts, unauthorized approvals, executions, and execution steps remained unchanged (`status: pending`, `decided_at: null`, `status: waiting_approval`).
   - Verified that authorized execution in Location A1 expired only Location A1, leaving Location A2 untouched.
   - Verified that global worker maintenance (`operza_worker`) expired Location A2 and Tenant B approvals cleanly.
3. **P1 Elimination of `activeLocation?.id || agency.id` Fallbacks in API:**
   - Reviewed and removed all instances in `apps/api/server.mjs` where `agency.id` silently substituted for a missing `activeLocation?.id`.
   - In `GET /api/workflows/runs`, `GET /api/workflows/approvals`, and approval decision routes (`POST /api/workflows/runs/:id/approve` and `/reject`), enforced mandatory active location context returning HTTP 400 with code `LOCATION_REQUIRED` if absent.
   - Strict `location_id = $2` equality applied in `GET /api/workflows/runs` under PostgreSQL.
   - In `expirePendingWorkflowApprovals(agencyId, locationId)`, fail-closed enforcement requires both IDs when PostgreSQL is active and prevents memory fall-through.
4. **P1 Security-Definer Inventory Alignment:**
   - Updated `docs/SECURITY_DEFINER_INVENTORY.md` to record Migration 027 invariants, ownership, and caller specifications.

---

## Test Verification Summary

| Suite / Verification Component | Tests Run | Passed | Failed | Status |
|---|---|---|---|---|
| `@operza/db` Test Suite (PostgreSQL RLS, Leases, Constraints) | 59 | 58 (1 skipped for CI) | 0 | **PASS** |
| `@operza/workflow-engine` Test Suite (Actions, Governance, Walkers) | 66 | 66 | 0 | **PASS** |
| `apps/api` Test Suite (Multi-process, Auth Authority, Workflows) | 121 | 121 | 0 | **PASS** |
| End-to-End System Verification (`scripts/test-e2e.mjs`) | 116 | 116 | 0 | **PASS** |
| SEO & Metadata Audit (`scripts/seo-audit/run-seo-checks.mjs`) | 106 | 106 | 0 | **PASS** |
| Production Dependency Audit (`npm audit --omit=dev --audit-level=high`) | Checked | 0 High/Crit | 0 | **PASS** |

---

## Commit & Migration Invariants

1. **Forward-Only Migration:**
   - Migration `027_strict_location_boundary_repair.sql` was added. Historical migrations `001` through `026` were untouched.
   - Total migration count: 27 sequential migrations (`001` to `027`).
2. **Definer Role & Least-Privilege Execution:**
   - Functions are owned by unprivileged `operza_auth_definer` (`NOLOGIN`, `NOSUPERUSER`, `NOCREATEROLE`, `NOINHERIT`, `BYPASSRLS`).
   - Unprivileged `operza_migrator` applies migration 027 using its membership in `operza_auth_definer`.
   - `PUBLIC` execution is strictly revoked.
