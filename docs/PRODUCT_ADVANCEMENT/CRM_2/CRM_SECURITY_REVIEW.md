# CRM 2.0 Security Review

- **Tenant Isolation:** All CRM 2.0 tables (`crm_custom_field_defs`, `crm_smart_lists`, `crm_contact_merge_audit`) enforce `FORCE ROW LEVEL SECURITY` and `TenantTx`.
- **No Arbitrary SQL:** `validateSmartListAst()` restricts filter fields to allowlisted CRM attributes and `customFields.<key>` identifiers, with max nesting depth `4` and max `50` rules.
- **CSV Formula Injection Defense:** `parseAndValidateCsvImport()` & `exportContactsToCsv()` sanitize formula-prefixed cells (`=`, `+`, `-`, `@`).
- **Concurrency Safety:** `mergeContactsSafely()` acquires `SELECT ... FOR UPDATE` locks in sorted UUID order and returns `409 MERGE_CONFLICT` if a secondary contact was already merged.
