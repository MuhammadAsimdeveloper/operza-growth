# Offboarding & Session Revocation

- `POST /api/agency/v2/team/:userId/offboard` runs inside a `TenantTx` transaction: protects the last active owner, marks `agency_memberships` and `user_location_memberships` inactive, revokes all active `auth_sessions` (`revoked_at`, `revoked_by`), and preserves all CRM/conversation/ticket/audit records.
- `GET /api/agency/v2/sessions` & `POST /api/agency/v2/sessions/:id/revoke` list and revoke active sessions without exposing raw session tokens or CSRF hashes; honestly notes native TOTP/WebAuthn MFA is not enabled in local auth.
