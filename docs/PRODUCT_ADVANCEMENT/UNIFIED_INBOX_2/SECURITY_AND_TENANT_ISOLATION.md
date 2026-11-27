# Security & Tenant Isolation — Stage 15

- **Tenant & Location Isolation**: Every database operation runs inside `runInTenantTx` with `FORCE ROW LEVEL SECURITY` on `conversations`, `messages`, `engagement_conversation_notes`, `engagement_conversation_history`, `support_teams`, `sla_policies`, `support_tickets`, `support_saved_replies`, and `support_saved_views`.
- **Internal Note Privacy**: Internal notes are stored in `engagement_conversation_notes` (separate from `messages`), never transmitted to external channels, and excluded when `includeInternalNotes: false` (customer portal boundary).
- **Customer 360 Financial Gating**: `GET /api/support/v2/contacts/:contactId/360` only queries/returns `invoices` when `canViewFinancials(actor)` is true (`billing:read` / `payments:read` / owner/admin/billing/manager role).
- **Template & XSS Safety**: `validateSavedReplyTemplate` and `renderSafeSavedReply` enforce an explicit variable allowlist, reject `<script>` / `javascript:` URIs, and HTML-escape rendered values.
- **Audit Logging**: Assignment, lifecycle updates, public replies, internal notes, team creation, SLA policy creation, and ticket mutations emit structured audit events.
