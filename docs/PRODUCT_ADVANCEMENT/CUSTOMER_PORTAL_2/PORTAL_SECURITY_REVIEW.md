# Customer Portal 2.0 — Security Review

- **PostgreSQL `FORCE RLS` (`049_customer_portal_2_0.sql`):** All 5 portal tables enforce composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, and `operza_app` / `operza_worker` grants.
- **Token Security:** Magic links and session tokens are 32-byte CSPRNG values stored only as SHA-256 hashes (`token_hash`, `session_token_hash`), single-use, short-lived, and revocable.
- **Cross-Tenant & IDOR:** `verifyMagicLinkRecord`, `verifyPortalSessionRecord`, and `assertCustomerOwnsRecord` reject cross-agency/cross-customer access; `validatePortalRedirect` blocks open redirects.
