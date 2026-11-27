# Agency Workspace, Team Management & Access Governance 2.0 — Architecture Audit

**Stage:** Product Advancement Stage 17 — Agency Workspace, Team Management & Access Governance 2.0
**Branch:** `feat/operza-agency-launch-readiness`
**Starting Commit:** `f60bc5b`

---

## 1. Existing Multi-Tenant & Governance Inventory
1. **Core Schema (`001_agency_tenant_core.sql`)**: `agencies`, `users`, `agency_memberships` (`owner|admin|member|viewer`), `locations`, `agency_invitations`, `auth_sessions`, `agency_audit_events` with `FORCE ROW LEVEL SECURITY`.
2. **Subscriptions & Usage (`039_phase7_saas_marketplace_oauth_admin.sql`)**: `saas_subscriptions` (`plan_id`, `status`, `seat_limit`, `location_limit`), `PlanUsage.tsx`, and `/api/platform/plans` / `/api/platform/entitlements` / `/api/platform/usage`.
3. **Audit (`014_immutable_audit_events.sql`, `AuditLog.tsx`)**: Immutable audit events & `/api/audit`.

---

## 2. Gaps & Defects Identified
1. **In-Memory-Only `agency.mjs` Profile & Team**: `GET/PUT /api/agency/profile` and `/api/agency/team` mutate JSON `state` without PostgreSQL `TenantTx`/`FORCE RLS`.
2. **Incomplete Invitation Security**: `agency_invitations` lacks `token_hash`, `expires_at`, `location_ids`, `custom_role_id`, single-use replay protection, and honest `delivery_status` when no live email provider is configured.
3. **No Custom Roles or Location-Scoped Memberships**: Lacks `agency_roles` (with privilege-escalation guard) and `user_location_memberships` (`FORCE RLS`).
4. **No Session Revocation or Safe Offboarding**: `auth_sessions` lacks `revoked_at` / `revoked_by`, and offboarding lacks an impact preview and owner-protection guard.
5. **No Persistent Agency Onboarding State**: Onboarding progress is not durably persisted on `agencies`.
6. **Analytics Local-State Honesty**: `analytics2.mjs` `!pgPool` fallback must explicitly flag `authoritative: false` and `source: 'local_dev_in_memory'` so non-DB metrics are never mistaken for authoritative PostgreSQL results.
