# Stage 8 — Cross-Module Security Audit

**Date:** 2026-11-27  
**Baseline Commit:** `044f203`

---

## 1. Security Control Matrix

| Control Area | Enforcement Mechanism | Verification Evidence | Status |
|---|---|---|---|
| Cross-Tenant & Cross-Location Isolation | PostgreSQL `FORCE ROW LEVEL SECURITY` (`99` directives) + `TenantTx` (`app.agency_id`, `app.location_id`) | `@operza/db` `143/143` + `action-receipt-idempotency` Scenarios 1–30 | **PASS** |
| Role Escalation & API Key Scopes | `checkScope(actor, ...)` + role checks + `platform_admin_audit_log` | `zapier-authz.test.mjs`, `marketplace-2-0.test.mjs` | **PASS** |
| OAuth PKCE & Token Revocation | `S256` PKCE, redirect allowlist, single-use state, terminal revocation | `integrations-2-0.test.mjs` | **PASS** |
| Marketplace Permission & Upgrade Safety | Manifest validator (zero JS/SQL), downgrade defense, scope-escalation consent | `marketplace-2-0.test.mjs` | **PASS** |
| Workflow Action Governance | `@operza/action-governance` + `approval-lifecycle.mjs` (self-approval & cross-tenant blocked) | `6/6` action-governance + `79/79` workflow-engine | **PASS** |
| AI Tool Permission & Memory Isolation | `specialist.allowedTools ∩ parentAllowedTools`, `user` vs `agency` memory RLS, secret rejection | `ai-2-0.test.mjs` | **PASS** |
| Analytics Export & PII Redaction | Allowlisted SQL (`LIMIT <= 500`), PII redaction, CSV formula injection defense | `analytics-2-0.test.mjs` | **PASS** |
| Upload & Media Security | Magic-byte MIME validation, private quarantine, traversal defense; ClamAV adapter | `upload-scanner` unit tests; **live ClamAV blocked locally** | **PARTIAL** |
| PWA Cache Isolation | `clearTenantCache()` + `purgePwaTenantCaches()` on `logout()` & `switchLocation()` | `AuthContext.tsx` | **PASS** |
| API Rate Limiting & OTP Concurrency | IP + ID sliding window + `otp_request`/`otp_verify` limits | `phase-2b-independent-verification.test.mjs` (`429` vs `400` test expectation) | **PARTIAL** |
| Webhook Replay & SSRF Protection | Timestamped HMAC-SHA256 (`300s` window), private/loopback/metadata IP blocking, `redirect: 'error'` | `integrations-2-0.test.mjs`, `workflow-engine` SSRF tests | **PASS** |
| Dependency Supply Chain | `npm audit --omit=dev` | `0 critical, 0 high, 0 moderate, 0 low` (`0 total`) | **PASS** |

## 2. Open Security/Assurance Gates
- Live **Redis distributed rate-limiting** across multiple API instances (no Redis/Docker on Windows host).
- Live **ClamAV** EICAR malware scan in staging container.
- **Independent third-party penetration test** (handoff prepared in `docs/PHASE_8_1/EXTERNAL_PEN_TEST_HANDOFF.md`).
