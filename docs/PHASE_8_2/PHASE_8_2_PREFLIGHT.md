# Phase 8.2 Preflight — Staging Readiness & External Assurance

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Starting HEAD:** `3eaf9274cedaef1b736b92c6543807ab05559761` (`3eaf927`)
**Working Tree:** Clean (`[ahead 15]`, not pushed)

---

## 1. Baseline & Remaining Blockers
- **Dependencies:** `0 critical`, `0 high`, `2 moderate` (`react-router` / `react-router-dom` `6.26.2`).
- **Upload Endpoints:** `POST /api/media/upload` and `GET /api/media/file/:id` in `apps/api/server.mjs` are not yet wired through `createUploadQuarantineService()` (`upload-scanner.mjs`).
- **Rate Limiter:** `auth-rate-limiter.mjs` supports Redis + memory fallback; degraded-mode behavior under horizontal scaling needs explicit policy & documentation.
- **Host Infrastructure:** Docker, Redis, ClamAV daemon, and managed PITR PostgreSQL are unavailable on this Windows host; staging stack will be prepared via `docker-compose.staging.yml` + `.env.staging.example`, with live multi-worker/ClamAV/PITR runtime checks marked `BLOCKED` locally.
