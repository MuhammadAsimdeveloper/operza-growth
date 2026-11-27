# Security & Tenant Isolation — Stage 17

- `agency_roles` and `user_location_memberships` enforce `FORCE ROW LEVEL SECURITY` (`agency_id = current_setting('app.agency_id')`).
- Server-side authorization (`requireAdminOrPerm`) protects all `/api/agency/v2/*` mutations; frontend UI hiding is never relied upon as a security boundary.
- `updateAgencyWorkspace` catches PostgreSQL `23505` unique constraint violations under `FORCE RLS` and returns `409 DUPLICATE_WORKSPACE_SLUG`.
