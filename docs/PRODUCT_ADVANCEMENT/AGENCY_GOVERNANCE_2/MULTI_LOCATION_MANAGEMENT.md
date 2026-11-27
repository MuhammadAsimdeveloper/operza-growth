# Multi-Location Management

- `locations` (`001`, extended in `052`) supports creating, editing, archiving (`status = 'inactive'`, `archived_at`), and restoring (`status = 'active'`) locations without deleting business records.
- `user_location_memberships` (`FORCE ROW LEVEL SECURITY`) binds non-admin users to explicit location IDs; `assertUserHasLocationAccess` prevents guessing a `locationId` to access another branch.
