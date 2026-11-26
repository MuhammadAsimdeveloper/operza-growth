# CRM 2.0 Implementation Plan

1. **Migration `040_crm_2_0.sql`:** Add `crm_custom_field_defs`, `crm_smart_lists`, `crm_contact_merge_audit` (`FORCE RLS` + `operza_app` grants) and functional/trigram search indexes on `location_records`.
2. **CRM 2.0 Core Logic (`packages/platform-core/src/crm/segmentation.mjs`, `contacts-2.0.mjs`):** Email/phone normalization, duplicate scoring (exact email, normalized phone, name+company warning), AND/OR nested Smart List AST validation & evaluation (zero arbitrary SQL), and strict custom-field schema validation.
3. **Repository Advancement (`packages/db/lib/contacts-repository.mjs` & `crm-2-repository.mjs`):**
   - `findDuplicates(tx)`
   - Concurrency-safe `merge()` with `FOR UPDATE` row locking, full relational re-linking (`opportunities`, `appointments`, `conversations`, `tasks`, `invoices`, `reviews`, `form_submissions`), and `crm_contact_merge_audit` recording.
   - `getCustomer360Profile(tx, contactId, { timelineLimit, timelineOffset })`
   - `SmartLists` & `CustomFieldDefs` CRUD via `TenantTx`.
4. **API Routes (`apps/api/routes/contacts.mjs`, `crm.mjs`):** Expose `/api/crm/contacts/duplicates`, `/api/crm/contacts/:id/profile`, `/api/crm/contacts/import/preview`, `/api/crm/smart-lists`, and `/api/crm/custom-fields`.
5. **Frontend (`ContactDetail.tsx`, `SmartLists.tsx`):** Add TanStack Query integration for Customer 360° profile and persisted Smart Lists while preserving existing UX.
6. **Verification:** Unit tests, real PostgreSQL `FORCE RLS` + concurrent merge tests, frontend typecheck/build, E2E regression, and documentation.
