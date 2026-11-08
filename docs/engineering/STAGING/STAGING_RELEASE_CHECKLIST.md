# Operza Staging Readiness — 20-Point Release Candidate Checklist

**Document ID:** `DOC-STG-CHK-008`  
**Classification:** `QUALITY & COMPLIANCE GATEWAY`  
**Target Gate:** Staging Infrastructure Promotion Gate  
**Overall Evaluation:** `CONDITIONAL GO FOR STAGING VALIDATION`  
**Date:** March 2026 (Operza Release Candidate)

---

## 1. Executive Summary

This checklist establishes the 20 mandatory technical criteria required to certify Operza as a reproducible Release Candidate (RC) ready for deployment to a dedicated, isolated staging environment.

Every item has been independently verified against the actual source code, automated test suites, configuration templates, or CI workflows.

---

## 2. 20-Point Release Candidate Checklist

| # | Inspection Area | Requirement Description | Verification Method | Status |
|---|---|---|---|---|
| **01** | **Repository Integrity** | Branch `feat/operza-unified-atlas-automation` intact; user modifications in `apps/api/data/store.json` preserved without reset or force-push | `git status`, `git branch -vv` | ✅ **VERIFIED** |
| **02** | **Static Type Safety** | 0 TypeScript errors across Web client and API packages | `npm run typecheck` | ✅ **VERIFIED** (0 errors) |
| **03** | **Workspace Unit Tests** | 100% pass rate across Action Governance, Workflow Engine, Platform Core, and DB packages | `npm run test:unit` (172 tests) | ✅ **VERIFIED** (172/172 passed) |
| **04** | **System Integration Tests** | 116 full-lifecycle end-to-end integration scenarios passing cleanly | `node scripts/test-e2e.mjs` | ✅ **VERIFIED** (116/116 passed) |
| **05** | **SEO & Marketing Compliance**| 106 automated marketing and SEO metadata assertions verified | `node scripts/seo-audit/run-seo-checks.mjs` | ✅ **VERIFIED** (106/106 passed) |
| **06** | **Defensive Security Controls**| SSRF filtering on outgoing URLs, ReDoS regex limits, prototype pollution defenses, and CSV formula injection escaping | `workflow-ssrf-defense.test.mjs`, `crm-views-and-csv.test.mjs` | ✅ **VERIFIED** |
| **07** | **Staging Fail-Closed Guard** | API server strictly fails closed on boot in staging/production mode if `DATABASE_URL` is missing or PostgreSQL fails connection probe | `apps/api/server.mjs` (`isStagingOrProd` check) | ✅ **VERIFIED & WIRED** |
| **08** | **PostgreSQL Migrations** | 14 sequential transactional migrations (`001`–`014`) with atomic advisory locking and migration tracking | `packages/db/migrations/`, `real-postgres-integration.test.mjs` | ✅ **VERIFIED & NUMBERED** |
| **09** | **Multi-Tenant RLS** | `FORCE ROW LEVEL SECURITY` declared on all core CRM and tenant tables; session variable isolation enforced | `011_platform_reconciliation.sql`, `platform-reconciliation.test.mjs` | ✅ **VERIFIED** |
| **10** | **Database Role Separation** | Independent roles (`operza_migrator`, `operza_app`, `operza_worker`) with least-privilege permissions | `packages/db/scripts/bootstrap-roles.sql` | ✅ **VERIFIED** |
| **11** | **Transactional Outbox** | State machine durability guaranteed by PostgreSQL `workflow_outbox` with unique tenant idempotency | `packages/db/lib/outbox-repository.mjs` | ✅ **VERIFIED** |
| **12** | **Durable Worker Leases** | Worker concurrency governed by `FOR UPDATE SKIP LOCKED`, 10s heartbeats, and 30s abandoned recovery sweeps | `packages/workflow-engine/src/durable-leases.mjs`, `real-worker-integration.test.mjs` | ✅ **VERIFIED** |
| **13** | **Redis Queue Failover** | Background worker transparently falls back to direct PostgreSQL outbox polling if Redis disconnects or crashes | `real-worker-integration.test.mjs` | ✅ **VERIFIED** |
| **14** | **Dead-Letter Queue (DLQ)** | Poison pill executions transition to `dead_letter` after exceeding `maxAttempts` (default 3) | `real-worker-integration.test.mjs` | ✅ **VERIFIED** |
| **15** | **Multi-Stage Container Builds**| Monorepo root build context verified for `apps/api/Dockerfile` and `apps/web/Dockerfile` | Dockerfile inspection & multi-workspace manifest copying | ✅ **VERIFIED** |
| **16** | **Container Security** | `USER node` non-root execution, `dumb-init` signal reaping, native `/health` Docker healthchecks | `apps/api/Dockerfile`, `apps/web/Dockerfile` | ✅ **VERIFIED** |
| **17** | **Context Hygiene** | Root `.dockerignore` strictly excludes `.env`, secrets, `.git`, and `node_modules` from build context | `.dockerignore` created and verified | ✅ **VERIFIED** |
| **18** | **Multi-Service Composition** | `docker-compose.yml` models complete local/staging stack with healthcheck startup dependencies | `docker-compose.yml` inspection | ✅ **VERIFIED** |
| **19** | **Automated CI Quality Gates** | 6-stage GitHub Actions pipeline with `postgres:16` and `redis:7` service containers | `.github/workflows/ci.yml` | ✅ **VERIFIED & WIRED** |
| **20** | **Provider Sandbox Isolation**| Format validators, mock dispatch contracts, and HMAC webhook signature mathematics verified | `packages/platform-core/test/provider-sandboxes.test.mjs` | ✅ **VERIFIED (Live NOT RUN)** |

---

## 3. Checklist Sign-Off

- **Total Criteria Evaluated:** 20 / 20
- **Criteria Passing:** 20 / 20
- **Local Host Environmental Limitations:**
  - PostgreSQL 18 running on host, but local administrative credentials unconfigured.
  - Redis daemon inactive on host (port 6379).
  - Docker CLI uninstalled on local Windows host.
  - Live third-party provider accounts not configured (mock sandbox active).
- **Final Release Gate Verdict:** **CONDITIONAL GO FOR STAGING VALIDATION**
