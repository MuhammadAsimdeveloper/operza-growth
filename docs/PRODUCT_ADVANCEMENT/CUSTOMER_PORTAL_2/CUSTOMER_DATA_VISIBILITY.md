# Customer Portal 2.0 — Data Visibility & Field Governance

- **Profile Allowlist (`sanitizeCustomerProfilePatch`):** Customers can update only agency-configured fields (`firstName`, `lastName`, `phone`, `company`, `timezone`, `preferredLanguage`). Attempts to modify `portalAccess`, `tags`, `leadScore`, or `ownerId` fail with `RESTRICTED_PROFILE_FIELD`.
- **Internal Note Isolation (`filterCustomerVisibleMessages`):** Messages with `senderType === 'internal_note'`, `isInternal === true`, or `visibility === 'internal'` are stripped before customer delivery.
- **IDOR Prevention (`assertCustomerOwnsRecord`):** Every record lookup verifies `(agency_id, location_id, contact_id)` against the authenticated portal session.
