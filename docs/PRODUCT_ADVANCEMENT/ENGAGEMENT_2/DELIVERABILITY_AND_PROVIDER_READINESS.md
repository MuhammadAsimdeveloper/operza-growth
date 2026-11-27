# Engagement 2.0 — Deliverability & Provider Readiness

- **Email (Resend / SendGrid):** Adapter contracts verified in `provider-adapters.test.mjs`; live sender domain authentication (SPF/DKIM/DMARC) and live API keys remain disabled locally.
- **SMS (Twilio):** Adapter contract verified; live A2P 10DLC campaign registration and Twilio credentials remain disabled locally.
- **WhatsApp (Meta Cloud API):** Adapter contract verified; `validateTemplate` enforces `provider_template_id` before marking WhatsApp templates `approved`.
- **Policy:** No real customer emails, SMS, or WhatsApp messages are dispatched during development or test runs.
