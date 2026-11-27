# Engagement 2.0 — Campaign Engine & Templates Design

- **Supported Channels:** `email`, `sms`, `whatsapp`, `internal_notification`.
- **Campaign Lifecycle:** `draft` -> `ready_for_review` -> `approved` -> `scheduled` -> `sending` -> `paused` -> `completed` | `failed` | `cancelled` (`canTransitionCampaign`).
- **Audience Segmentation:** Backed by CRM 2.0 Smart Lists (`smart_list_id`) and stored `audience_snapshot` JSONB for explainability.
- **Durable Recipient Tracking:** `engagement_campaign_recipients` enforces `UNIQUE (agency_id, location_id, campaign_id, contact_id)` and `UNIQUE (agency_id, location_id, idempotency_key)` (`buildRecipientIdempotencyKey`).
- **Error Classification:** `classifyProviderDeliveryError` separates permanent `4xx` errors (`retryable: false`) from `429`/`5xx` transient errors (`retryable: true`).
- **Templates:** `validateTemplate` & `renderSafeTemplate` block `<script>` / `javascript:`, validate `{{...}}` variables, HTML-escape email values, and require `provider_template_id` before a WhatsApp template can be marked `approved`.
