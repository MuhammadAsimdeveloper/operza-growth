# CRM 2.0 Architecture Audit

**Date:** 2026-11-26
**Branch:** `feat/operza-agency-launch-readiness`
**Baseline Commit:** `e7fd009`

---

## 1. Existing Working Features
- `ContactsRepository` (`packages/db/lib/contacts-repository.mjs`): `TenantTx`-scoped `create`, `getById`, `list`, `update`, `delete`, `bulkTag`, `merge`, `getTimeline`.
- `apps/api/routes/contacts.mjs`: Modular router delegating to `ContactsRepository` + `parseAndValidateCsvImport` / `exportContactsToCsv` (`csv-transfer.mjs` with formula-injection defense).
- `apps/web/src/pages/Contacts.tsx`: Uses TanStack Query (`useQuery`).

## 2. Gaps & Defects Identified
1. **No Customer 360° Aggregated Profile:** No single `TenantTx` endpoint aggregates contacts with opportunities, tasks, appointments, conversations, consents, orders, invoices, payments (grouped by currency), reviews, and paginated timeline.
2. **Duplicate Detection & Merge Concurrency:** `ContactsRepository.merge()` lacks `SELECT ... FOR UPDATE` row locking against simultaneous merges, does not re-link `appointments`, `conversations`, `tasks`, `invoices`, `reviews`, or `form_submissions`, and lacks a merge audit table. Also lacks `findDuplicates()` (exact normalized email, phone digits, and name+company warning).
3. **Smart Lists & Custom Fields Persistence:** `SmartLists.tsx` & `ContactDetail.tsx` still use `useStore()` (`state` in memory) instead of PostgreSQL `crm_smart_lists` and `crm_custom_field_defs` with `FORCE RLS`.
4. **Search Indexing:** `location_records` lacks targeted functional indexes on `lower(body->>'email')`, `body->>'phone'`, and trigram name/company search.
5. **CSV Dry-Run Preview:** `contacts.mjs` lacks a non-mutating `POST /api/crm/contacts/import/preview` endpoint with duplicate detection before commit.
