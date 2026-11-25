# Integration Hub Inventory

| Integration | Authentication | Triggers | Actions | Webhooks | Test status |
| --- | --- | --- | --- | --- | --- |
| Stripe (`payments.stripe`) | API Key (`sk_test_`/`sk_live_`) | `charge_succeeded`, `invoice_paid`, `refund_created` | `create_payment_intent`, `issue_refund`, `create_connect_account` | Verified (`/api/webhooks/stripe`) | **Sandbox connected & verified** |
| Twilio (`sms.twilio`) | Basic Auth (SID + Token) | `sms_inbound`, `call_status` | `send_sms` | Verified (`/api/webhooks/twilio`, `/status`) | **Adapter & webhooks verified** |
| SendGrid (`email.sendgrid`) | Bearer API Key (`SG.*`) | `inbound_email` | `send_email` | Verified (`/api/webhooks/sendgrid`, `/events`) | **Adapter & webhooks verified** |
| Resend (`email.resend`) | Bearer API Key (`re_*`) | — | `send_email` | — | **Adapter verified** |
| WhatsApp (`whatsapp.meta_cloud`) | Bearer Token + Phone ID | `whatsapp_message` | `send_whatsapp` | Verified (`/api/webhooks/whatsapp`) | **Adapter & webhook verified (approval pending)** |
| Zapier (`zapier`) | HMAC Signing Secret | 14 REST Hook / Poll triggers | 12 Actions + 4 Searches | Verified (`/api/v1/zapier/hooks/*`) | **Sandbox & E2E verified** |
| Slack, Gmail, Google Sheets, HubSpot, Shopify, Airtable, Mailchimp, Calendly + 11 catalog connectors | OAuth2 / API Key | Defined in `connector-catalog.mjs` | Defined in `connector-catalog.mjs` | — | **Catalog only (registered in SDK with honest `catalog_only` status)** |
