# ClamAV & Upload Security Results

- **Live EICAR Scan:** **NOT EXECUTED** (`clamdscan` is not installed on this Windows host).
- **Fail-Closed Contract Verified (`stage22_verify.mjs` & `apps/api/server.mjs:6800-6809`):**
  - Invoked `createClamAvScanner({ binaryPath: 'nonexistent-clamdscan-binary' }).scanBuffer(...)`.
  - **Result:** Returned `{ status: "unavailable" }` (never `"clean"`). In `server.mjs`, when `CLAMAV_REQUIRED=true` and `status !== 'clean'`, the upload endpoint returns HTTP `503 MALWARE_SCANNER_UNAVAILABLE` and quarantines/rejects the upload.
