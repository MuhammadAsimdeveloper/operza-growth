# Phase 8.3 — ClamAV & Upload-Path Staging Verification

- **Pinned Staging Container:** `clamav/clamav:1.4` (`docker-compose.staging.yml`).
- **Enforced Upload Paths:** `POST /api/media/upload` & `GET /api/media/file/:id` (`apps/api/server.mjs`), plus `createUploadQuarantineService()` (`upload-scanner.mjs`).
- **Live ClamAV Daemon & EICAR Check:** **BLOCKED locally** (no Docker / `clamscan` / `clamdscan` on Windows host).
- **Verified Locally:** Magic-byte signature checks, `../` path-traversal rejection, `MEDIA_QUARANTINED` blocking, and fail-closed `MALWARE_SCANNER_UNAVAILABLE` behavior (`phase8-1-remediation.test.mjs`).
