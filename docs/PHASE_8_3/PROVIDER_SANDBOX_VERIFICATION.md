# Phase 8.3 — Provider Sandbox Verification

- **Verified Sandbox Adapters (Deterministic / Local):**
  - Stripe Connect sandbox adapter, invoice PDFs, coupons, dunning (`verify-ci-postgres.mjs` / Phase 3).
  - AI Provider Gateway (`provider-gateway.mjs`), Integration Hub SDK (`integration-sdk.mjs`), Calendar OAuth PKCE (`outlook-oauth.mjs`).
- **Live Sandbox Network Connectivity Status:** **BLOCKED** (live Stripe/Twilio/SendGrid/WhatsApp/Gemini/OpenAI/Anthropic sandbox API keys are not configured in this local environment).
