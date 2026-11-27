# Customer Portal 2.0 — Identity & Access Model

- **Role Separation:** External customers authenticate into `customer_portal_sessions` with `role: 'external_customer'` and are strictly isolated from internal `users`, agency admins, and `platform_admins`.
- **Multi-Agency Isolation:** Every magic link and session is bound to `(agency_id, location_id, contact_id)`. Having the same email in two agencies never merges or exposes data across agencies.
- **Magic Links:** 32-byte CSPRNG tokens stored only as SHA-256 hashes (`token_hash`), single-use (`consumed_at`), short TTL (`15` minutes default), and bound to intended `(agency_id, location_id, contact_id)`.
- **Open Redirect & Enumeration Defense:** `validatePortalRedirect` allows only relative `/` paths; magic-link requests return a uniform generic acknowledgement regardless of whether the email exists.
