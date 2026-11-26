# Phase 7 — Platform Administration Security

**Routes:** `apps/api/routes/phase7.mjs` (`/api/platform-admin/*`), `apps/api/routes/system.mjs` (`/api/admin/*`)
**Audit Table:** `platform_admin_audit_log` (Migration `039`)

- **Privilege Separation:** Platform admin endpoints require `actor.isPlatformAdmin === true` and return `403 PLATFORM_ADMIN_REQUIRED` for agency owners and admins.
- **Auditability:** All marketplace reviews and platform admin actions write immutable records to `platform_admin_audit_log` with `actor_id`, `action`, `target_type`, `target_id`, `reason`, and `created_at`.
