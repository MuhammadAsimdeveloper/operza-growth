# Customer Portal 2.0 — Billing & Document Access

- **Orders & Invoices:** Customers view only records matching their authenticated `(agency_id, location_id, contact_id)`. Invoices render with currency-safe integer minor-unit formatting and PDF export (`invoice-pdf.mjs`).
- **No Raw Card Storage:** Payment method updates and checkouts must use provider-hosted Stripe flows; Operza never stores raw card numbers.
- **Refund & Cancellation Requests:** Customers submit `refund_review` or `order_cancellation` via `customer_portal_requests`; sensitive requests require explicit agency approval (`requested` -> `approved` -> `completed`) and never execute direct refunds automatically.
- **Documents & Media:** Private documents are gated by tenant/contact ownership and ClamAV scan status (`site_media_assets` / `upload-scanner.mjs`).
