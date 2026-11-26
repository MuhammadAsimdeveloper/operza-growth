# CRM 2.0 API Reference

- `GET /api/crm/contacts/duplicates` — Detect high-confidence (exact email/phone) and warning (name+company) duplicate groups.
- `POST /api/crm/contacts/import/preview` — Non-mutating CSV dry-run validation & duplicate detection.
- `POST /api/crm/contacts/merge-safe` — `FOR UPDATE`-locked contact merge across opportunities, appointments, tasks, conversations, invoices, reviews, forms, and audit trail.
- `GET /api/crm/contacts/:id/profile` — Customer 360° aggregated profile with paginated chronological timeline (`timelineLimit`, `timelineOffset`).
- `GET/POST /api/crm/v2/smart-lists` & `GET /api/crm/v2/smart-lists/:id/evaluate` — Persisted AND/OR Smart Lists.
- `GET/POST /api/crm/v2/custom-fields` — Custom field definitions.
