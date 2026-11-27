# Customer 360 Consistency

- `getCustomer360Context` (`packages/db/lib/unified-inbox-repository.mjs`) aggregates `location_records` (`contacts`, `opportunities`, `appointments`, `invoices`), `communication_consents`, and `support_tickets` under `TenantTx` + `FORCE RLS`.
- Financial records (`invoices`) are gated behind `includeFinancials` (`billing:read` / `payments:read` / owner/admin/billing/manager role).
- Internal staff notes (`engagement_conversation_notes`) are never exposed to portal or restricted callers.
- Added bidirectional UI links between `ContactDetail.tsx` (`Unified Inbox`) and `SupportInbox2Panel.tsx` (`View Customer 360 →`).
