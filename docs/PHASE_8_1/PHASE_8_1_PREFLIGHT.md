# Phase 8.1 Preflight — Release Blocker Remediation

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `6f31989715bc66e0a7b01f585d2c37fb449eca34` (`6f31989`)
**Working Tree:** Clean (`[ahead 14]`, not pushed)

---

## 1. Baseline Advisories Reproduced (`npm audit --omit=dev`)
- `1 critical` (`astro <=7.4.6` in `apps/marketing`)
- `4 high` (`vite <=6.4.3`, `sharp`, `zod`, `zod-to-ts`)
- `3 moderate` (`react-router-dom`, `react-router`, `esbuild`)

## 2. Host Infrastructure Check
- `clamscan` / `clamdscan`: **Not installed** on local Windows host.
- `redis-server` / `docker`: **Not installed** on local Windows host.
- `pg_dump.exe` / `pg_restore.exe`: Available (`PostgreSQL 18`), but managed WAL/PITR archiving requires cloud/managed PostgreSQL staging.

## 3. Remediation Scope
1. Safely upgrade `astro` in `apps/marketing` and evaluate `vite` / `react-router-dom`, regenerate CycloneDX SBOM, and re-run `npm audit`.
2. Implement layered authentication rate limiting (IP + account identifier, trusted-proxy handling, Redis-ready store with safe in-memory fallback, `Retry-After`, enumeration resistance, no permanent lockout DoS).
3. Implement extensible upload quarantine & malware scanning boundary (magic-byte signature checks, quarantine isolation, ClamAV adapter, fail-closed policy when scanner unavailable).
4. Document honest Redis/multi-worker & PITR staging blockers and complete `EXTERNAL_PEN_TEST_HANDOFF.md` + updated OWASP ASVS L2 assessment.
