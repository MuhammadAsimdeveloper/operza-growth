# Operza Phase 8: Integrations, Telephony & Omnichannel Communications

## 1. Executive Summary

Phase 8 elevates Operza into an enterprise omnichannel communication hub. Rather than coupling business logic directly to external HTTP APIs, Operza abstracts third-party providers behind **verified adapters**, **encrypted credential vaults**, and **regulatory consent ledgers**.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                     OPERZA OMNICHANNEL INTEGRATION RUNTIME                        │
└───────────────────────────────────────────────────────────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  Email Delivery                   SMS & Telephony                  WhatsApp Cloud
 (Resend / SendGrid)               (Twilio Voice/SMS)              (Meta Graph v21)
        │                                │                                │
        └────────────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │       Consent Ledger Verification     │
                     │  (GDPR / TCPA Explicit Proof Check)   │
                     └───────────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │      KMS Authenticated Encryption     │
                     │   (AES-256-GCM / Zero Raw Exposure)   │
                     └───────────────────────────────────────┘
```

---

## 2. Integrated Provider Adapters

All provider adapters are registered in `packages/platform-core/src/provider-adapters.mjs` and conform to the standard interface:
`verify({ secret, config }) -> { verified: boolean, accountId?: string, error?: string }`
`dispatch({ secret, config, payload, consent }) -> { ok: boolean, messageId?: string, error?: string }`

### 2.1 Resend Email Adapter
- **Provider Key:** `email.resend`
- **Channel:** `email`
- **Verification Rule:** API keys must begin with `re_` and have minimum length 12. Sender email must be valid RFC-5322 format.
- **Fail-Closed Gate:** Refuses dispatch if recipient has not granted explicit communication consent (`consent.status === 'granted'`).

### 2.2 SendGrid Email Adapter
- **Provider Key:** `email.sendgrid`
- **Channel:** `email`
- **Verification Rule:** API keys must begin with `SG.` and have minimum length 16.

### 2.3 Twilio SMS & Voice Adapter
- **Provider Key:** `sms.twilio`
- **Channel:** `sms` / `voice`
- **Verification Rule:** Validates Twilio Account SID (`AC...`) and Auth Token (minimum 16 chars).
- **Features:** Automated number provisioning, inbound IVR call routing, dialer, call recording, and SMS webhook ingestion.

### 2.4 Meta WhatsApp Cloud API Adapter
- **Provider Key:** `whatsapp.meta_cloud`
- **Channel:** `whatsapp`
- **Verification Rule:** Validates Meta System User Bearer Token (minimum 20 chars) and WhatsApp Phone Number ID.
- **Message Types:** Supports approved HSM template messages and interactive quick-reply buttons.

### 2.5 Stripe Payments Adapter
- **Provider Key:** `payments.stripe`
- **Channel:** `payments`
- **Verification Rule:** Restricts API keys to secret or restricted key formats (`sk_...` or `rk_...`, minimum 20 chars).
- **Security:** Raw card data never touches Operza servers; transactions use Stripe Elements, PaymentIntents, and signed webhooks.

---

## 3. Credential Security: KMS Secret Vault

- **File:** `packages/platform-core/src/secret-vault.mjs`
- **Cipher:** `AES-256-GCM` with 96-bit random initialization vectors (IV) and 128-bit authentication tags.
- **Reference Resolution:** Database records store only vault references (`ref:vault:conn_...` or `ref:kms:key_...`). Secrets are never logged, never returned over public REST APIs, and decrypted only transiently at the exact moment of worker execution.

---

## 4. Regulatory Consent Ledger (GDPR / TCPA)

- **File:** `packages/platform-core/src/consent-policy.mjs`
- **Policy Rules:**
  1. **Strict Context Binding:** Consent is isolated per `(tenantId, contactId, channel, purpose)`.
  2. **No Purpose Bleed:** Transactional consent granted for appointment booking or invoices cannot be used for marketing campaigns.
  3. **Newer Opt-Out Overrides:** Any subsequent unsubscribe or `STOP` message immediately creates a newer revoked record that terminates outbound messaging.
  4. **Proof Reference:** Every consent entry requires auditable proof (form submission ID, trigger link URL, or signed contract hash).

---

## 5. Verification Evidence

- `packages/platform-core/test/provider-adapters.test.mjs` (50 / 50 passing)
- End-to-End System Tests:
  - `[TEST 24] Omnichannel Voice Telephony: Call Initiation, Webhook Logging, & Recording Retrieval` (PASSED)
  - `[TEST 75] Omnichannel Webhook Replay Protection: Duplicate Stripe Event ID` (PASSED)
  - `[TEST 80] Provider connection is pending and secret references stay private` (PASSED)
  - `[TEST 81] Tenant-scoped communication consent and opt-out` (PASSED)
  - `[TEST 86] Encrypted Secret Vault & Provider Verification with Real Adapter` (PASSED)
