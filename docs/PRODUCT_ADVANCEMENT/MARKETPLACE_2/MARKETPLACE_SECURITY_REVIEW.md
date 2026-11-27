# Marketplace Security Review

## 1. Controls Verified
- **Zero Arbitrary Code Execution:** Manifests are strictly declarative JSON validated by `validateAppManifest`; no third-party JS/Python executes in the API process.
- **Platform Admin Separation:** `actor.isPlatformAdmin === true` enforced on all review/approval/suspension endpoints with `platform_admin_audit_log`.
- **Verified Reviews & Anti-Self-Review:** `submitReview` requires an active `marketplace_installations` row in `TenantTx` and rejects `publisher.owner_user_id === reviewerUserId` (`SELF_REVIEW_FORBIDDEN`).
- **Tenant `FORCE RLS`:** `marketplace_installations` and `marketplace_app_reviews` enforce composite `(agency_id, location_id, id)` `FORCE ROW LEVEL SECURITY` verified under `operza_app`.
