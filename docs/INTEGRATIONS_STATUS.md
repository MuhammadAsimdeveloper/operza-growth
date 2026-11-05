# Operza Integrations Status & Provider Matrix

| Integration | Category | Connection Model | Verification Strategy | Status |
| :--- | :--- | :--- | :--- | :---: |
| **Stripe** | Payments | Webhook / API Key | HMAC-SHA256 timestamp signature (`stripe-signature`) | **Verified** |
| **Twilio (SMS & Voice)** | Telephony | Webhook / Auth Token | HMAC-SHA1 signature (`x-twilio-signature`) against canonical URL | **Verified** |
| **Meta / WhatsApp Cloud API** | Messaging | Webhook / App Secret | `X-Hub-Signature-256` HMAC-SHA256 signature & verify token handshake | **Verified** |
| **Google OAuth 2.0** | Identity | OAuth Authorization Code | PKCE / State token anti-CSRF handshake | **Verified** |
| **Redis** | Infrastructure | Native RESP v2 TCP | PING / PONG heartbeat & atomic queue leases | **Verified** |
| **PostgreSQL** | Database | `pg` Pool with SSL | Table readiness query & transactional RLS config | **Verified** |
| **Gemini AI Studio** | AI | REST / Google Generative AI | API Key / Tool calling & token accounting | **Verified** |
| **Slack** | Ecosystem | Webhook / Bot Token | Signature verification on interactive payloads | **Connected Mock / Ready** |
| **Shopify / WooCommerce** | Commerce | Webhook / OAuth | Order synchronization on verified webhooks | **Schema Ready** |
