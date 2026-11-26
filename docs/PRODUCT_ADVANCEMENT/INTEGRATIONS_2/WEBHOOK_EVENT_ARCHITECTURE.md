# Webhook Event Architecture 2.0

**Module:** `packages/platform-core/src/webhook-platform-v2.mjs`  
**Tables:** `integration_webhook_endpoints`, `integration_webhook_events` (`042_integrations_2_0.sql`)

## 1. Inbound Verification & Normalization
```
External Provider POST
   │
   ▼
verifyWebhookSignature (HMAC-SHA256, 300s replay window, <=262KB)
   │  (reject invalid/expired before business logic)
   ▼
createNormalizedEventEnvelope (trusted agencyId + locationId from internal context)
   │
   ▼
INSERT INTO integration_webhook_events ... ON CONFLICT (agency_id, location_id, provider, provider_event_id) DO NOTHING
```

## 2. Outbound Signed Delivery & SSRF Guard
`deliverSignedOutboundWebhook` validates target URLs via `assertSafeTargetUrl` (blocking loopback, RFC 1918, metadata IPs, and non-HTTPS when `requireHttps: true`), signs payloads with `X-Operza-Signature: t=<ts>,v1=<hmac>`, sets `X-Operza-Delivery-Id`, and disables HTTP redirects (`redirect: 'error'`).
