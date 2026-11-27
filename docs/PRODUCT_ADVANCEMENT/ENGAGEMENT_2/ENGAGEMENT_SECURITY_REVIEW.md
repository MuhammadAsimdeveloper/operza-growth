# Engagement 2.0 — Security Review

- **Tenant & Location Isolation:** All 7 new tables in `046_engagement_2_0.sql` use composite `(agency_id, location_id, id)` primary keys, `FORCE ROW LEVEL SECURITY`, and least-privilege grants (`operza_app`, `operza_worker`).
- **XSS & Injection Defense:** `validateTemplate` rejects `<script>` and `javascript:` URLs; `renderSafeTemplate` HTML-escapes email variables and strips CRLF in SMS/WhatsApp.
- **Consent & AI Safety:** Pre-delivery `evaluateRecipientEligibility` rechecks suppression & consent; `generateAiInboxSuggestion` enforces human approval by default and on all opt-out intents.
- **Idempotency:** Recipient deliveries use deterministic SHA-256 `idempotency_key` with `UNIQUE (agency_id, location_id, idempotency_key)`.
