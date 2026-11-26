# CRM 2.0 Performance Report

- **Search & Duplicate Indexes:** Added functional indexes on `lower(body->>'email')`, `body->>'phone'`, and `pg_trgm` GIN on `(firstName || ' ' || lastName || ' ' || company)` in `040_crm_2_0.sql`.
- **Customer 360° Aggregation:** Executes parallel `Promise.all` parameterized `TenantTx` queries across source-of-truth tables and paginates the chronological timeline (`timelineLimit <= 100`, `timelineOffset >= 0`).
- **Currency Safety:** Payments in `getCustomer360Profile()` are grouped by `(currency, status)` in SQL without mixing currencies.
