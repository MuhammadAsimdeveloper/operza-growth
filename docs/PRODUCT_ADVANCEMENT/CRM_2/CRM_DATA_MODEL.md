# CRM 2.0 Data Model

- **`location_records` (`collection = 'contacts'`):** Indexed by `location_records_contacts_email_idx`, `location_records_contacts_phone_idx`, and `location_records_contacts_search_trgm_idx` (Migration `040_crm_2_0.sql`).
- **`crm_custom_field_defs`:** Tenant-scoped custom field schemas (`text | number | date | boolean | select | multi_select | url`) with `FORCE ROW LEVEL SECURITY`.
- **`crm_smart_lists`:** Persisted validated AND/OR filter ASTs with `FORCE ROW LEVEL SECURITY`.
- **`crm_contact_merge_audit`:** Immutable merge history recording `primary_contact_id`, `merged_contact_ids`, `merged_by`, and `snapshot_diff` with `FORCE ROW LEVEL SECURITY`.
