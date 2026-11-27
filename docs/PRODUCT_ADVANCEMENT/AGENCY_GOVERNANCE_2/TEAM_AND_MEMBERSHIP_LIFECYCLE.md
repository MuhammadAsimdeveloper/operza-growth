# Team & Membership Lifecycle

- `agency_memberships` (`001`, extended in `052`) distinguishes internal agency staff (`owner`, `admin`, `member`, `viewer`, `custom_role_id`) from external customer portal identities (`customer_portal_sessions`).
- `GET /api/agency/v2/team` supports search/status filtering and shows assigned location memberships.
- `assertOwnerProtected` prevents deactivating or demoting the last active `owner` (`409 LAST_OWNER_PROTECTED`).
