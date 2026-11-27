# Versioning & Release Lifecycle

**Module:** `packages/platform-core/src/marketplace-2-0.mjs`  
**Tables:** `marketplace_apps`, `marketplace_app_releases`

## 1. Lifecycle State Machine
- **App Statuses:** `draft` → `submitted` → `under_review` → `approved` → `published` → `suspended` / `deprecated` / `archived` (with `changes_requested` / `rejected` paths).
- **SemVer Downgrade Defense:** `submitNewVersion` enforces `compareSemver(nextVersion, currentVersion) > 0`.
- **Platform Admin Governance:** Only `actor.isPlatformAdmin === true` may invoke `/api/platform-admin/marketplace/v2/:id/transition`, recording an immutable `platform_admin_audit_log` entry.
