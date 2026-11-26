# Phase 7 — App & Integration Marketplace Architecture

**Repository:** `packages/db/lib/marketplace-repository.mjs`
**Integration Runtime:** `packages/platform-core/src/integration-sdk.mjs`

- **Review & Approval:** `marketplace_apps` starts at `submitted` and requires platform-admin review (`under_review -> approved -> published`) before any tenant can install it (`APP_NOT_APPROVED`).
- **Tenant Installation:** `marketplace_installations` enforces `TenantTx` + `FORCE RLS`, validates `granted_scopes` against `requested_scopes`, and clears `connection_id` on `uninstallApp()`.
- **Execution Boundary:** App actions execute only via the Phase 4 Integration Hub SDK; no arbitrary third-party code runs in the API process.
