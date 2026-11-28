# File Upload and Import Security — Stage 18

## 1. Upload Quarantine & Signature Validation (`packages/platform-core/src/security/upload-scanner.mjs`)

- **Magic-Byte Verification (`validateFileSignature`):** Validates binary headers for `application/pdf` (`%PDF-`), `image/png`, `image/jpeg`, and `text/plain` (rejects NUL bytes). Rejects SVG/HTML/executable uploads.
- **Size & Path Isolation:** `createUploadQuarantineService` enforces `maxBytes` (`5 MB` default), requires `(agencyId, locationId)`, and sanitizes filenames with `path.basename`.
- **Fail-Closed Malware Scanning:** When `failClosedOnUnavailable: true`, missing/unavailable `clamscan` returns `MALWARE_SCANNER_UNAVAILABLE` and keeps the upload quarantined (`publiclyAccessible: false`).
- **Honest Limitation:** Live `clamscan` daemon scanning has **not** been tested against a running ClamAV server in this local Windows environment.

## 2. CSV Import & Export Security (`packages/platform-core/src/csv-transfer.mjs` & `crm2.mjs`)

- Enforces `maxBytes` (`10 MB`), `maxRows` (`25,000`), `maxColumns` (`200`), and formula-injection defense (`FORMULA_PREFIX`).
- **Fixed in Stage 18:** `crm2.mjs` `POST /api/crm/contacts/import/preview` now passes `{ text, agencyId, locationId, existingContacts }` to `parseAndValidateCsvImport` and enforces `contacts:create` permission.
