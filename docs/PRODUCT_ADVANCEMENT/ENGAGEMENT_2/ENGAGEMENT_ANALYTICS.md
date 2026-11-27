# Engagement 2.0 — Customer Journey Analytics

`ENGAGEMENT_METRIC_DEFINITIONS` extends Analytics 2.0 with explicit numerator, denominator, date field, and source definitions:
- `conversations_opened`: `COUNT(conversations)` over `created_at` from `conversations`.
- `first_response_time_seconds`: `AVG(first_outbound.created_at - first_inbound.created_at)` over `first_inbound.created_at` from `messages`.
- `delivery_rate`: `COUNT(delivered) / COUNT(sent|delivered|failed)` over `updated_at` from `engagement_campaign_recipients`.
- `unsubscribe_rate`: `COUNT(opt_out) / COUNT(eligible_recipients)` over `created_at` from `engagement_suppression_list`.

Opens and clicks are not inferred without verified tracking instrumentation.
