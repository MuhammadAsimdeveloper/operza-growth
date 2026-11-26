# Upload Security Verification (Phase 8.2)

- **Enforced Entry Points:**
  - `POST /api/media/upload` (`apps/api/server.mjs`): Enforces 25 MB size cap, SVG script/event-handler stripping, magic-byte signature validation (`validateFileSignature()` for `application/pdf`, `image/png`, `image/jpeg`, `text/plain`), and `CLAMAV_REQUIRED=true` ClamAV scan (`422 MALWARE_DETECTED`, `503 MALWARE_SCANNER_UNAVAILABLE`).
  - `GET /api/media/file/:id` (`apps/api/server.mjs`): Validates `fileId` against `/^[a-zA-Z0-9_-]{3,80}$/` (blocks `../` path traversal) and blocks quarantined/unclean assets (`403 MEDIA_QUARANTINED`).
  - `createUploadQuarantineService()` (`packages/platform-core/src/security/upload-scanner.mjs`): Stages untrusted uploads in private quarantine and fails closed when no scanner daemon is available.
- **ClamAV Live Daemon Status:** **BLOCKED locally** (ClamAV not installed on Windows host). Provisioned via `clamav/clamav:stable` in `docker-compose.staging.yml` for staging EICAR verification.
