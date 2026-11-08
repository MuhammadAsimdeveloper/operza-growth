# Operza Staging Readiness — Provider Sandbox & Contract Guide

**Document ID:** `DOC-STG-SBX-006`  
**Classification:** `INTERNAL ENGINEERING SPECIFICATION`  
**Component:** Third-Party Provider Adapters & Webhook Security  
**Verification Suite:** `packages/platform-core/test/provider-sandboxes.test.mjs`  
**Automated Contract Test Status:** `100% PASSED (Unit & Contract)`  
**Live Network Delivery Status:** `NOT RUN (Requires live sandbox credentials)`  
**Date:** March 2026 (Operza Release Candidate)

---

## 1. Executive Summary

This guide details the integration contracts, sandbox test credentials, and webhook security mechanisms for all external providers integrated with Operza.

Operza employs a strict **Sandbox Isolation Policy**:
- Automated test suites and local environments operate against isolated sandbox adapters.
- Live outbound communications and financial charges require verified sandbox or live credentials with explicit tenant consent (`consent: { status: 'granted' }`).
- Live delivery tests are marked `NOT RUN` unless `LIVE_PROVIDER_TESTS=true` is explicitly provided.

---

## 2. Supported Provider Sandboxes & Specifications

### 1. Stripe Payments (`payments.stripe`)
- **Key Prefix:** `sk_test_...` or `rk_test_...` (Restricted Key). Minimum 20 characters.
- **Webhook Secret:** `whsec_...`
- **Supported Workflows:** 1-Click Upsell, Checkout sessions, Subscription billing, Refund processing.
- **Webhook Verification:**
  Enforces timestamped SHA-256 HMAC verification via `t=...,v1=...` header with timing-safe equality:
  ```javascript
  const expected = createHmac('sha256', webhookSecret).update(`${tPart}.${rawBody}`, 'utf8').digest('hex');
  timingSafeEqual(Buffer.from(v1Part, 'utf8'), Buffer.from(expected, 'utf8'));
  ```
- **Test Card Suite:**
  - Success: `4242 4242 4242 4242` (Any valid future expiration date, any 3-digit CVC).
  - Declined: `4000 0000 0000 0002`

---

### 2. Twilio SMS & Telephony (`sms.twilio`)
- **Account SID:** Starts with `AC`, exactly 34 characters.
- **Auth Token:** High-entropy string, minimum 16 characters.
- **Voice Token:** WebRTC softphone voice token generation with dynamic capability grants and ICE server configuration.
- **Magic Test Phone Numbers:**
  - `+15005550006`: Valid number, creates successful delivery receipt.
  - `+15005550001`: Invalid number, simulates failed delivery.
  - `+15005550009`: Simulates carrier queue exhaustion.
- **Consent Gate:** Outbound SMS dispatch is blocked with `CONSENT_REQUIRED` unless current, explicit consent is verified for the destination contact.

---

### 3. Resend & SendGrid Email (`email.resend`, `email.sendgrid`)
- **Resend Key Format:** Starts with `re_`, minimum 12 characters.
- **SendGrid Key Format:** Starts with `SG.`, minimum 16 characters.
- **Sender Verification:** Sender email addresses must be syntactically valid and belong to the verified tenant domain or Operza default notification domain (`notifications@operza.io`).
- **Idempotency:** Every dispatch requires a unique idempotency key preventing duplicate customer emails during worker retries.

---

### 4. Meta WhatsApp Cloud API (`whatsapp.meta_cloud`)
- **System User Access Token:** Starts with `EAA`, minimum 20 characters.
- **Phone Number ID:** Minimum 5 numeric characters.
- **Message IDs:** Emits standard WhatsApp message ID format (`wamid.HBgL...`).
- **Governance:** Enforces opt-in verification and template validation.

---

### 5. Zapier REST Hook Platform Integration
- **App Definition Manifest:** Discovered at `GET /api/v1/zapier/app-definition`.
- **Triggers Supported (14):** `contact.created`, `contact.updated`, `task.created`, `opportunity.stage_changed`, etc.
- **Actions Supported (12):** `create_contact`, `create_task`, `create_appointment`, `create_note`, `add_tag`, `remove_tag`.
- **Searches Supported (4):** `find_contact`, `find_opportunity`, `find_task`, `find_calendar`.
- **HMAC Delivery Signatures:** Outbound webhook payloads delivered to Zapier endpoints include `x-operza-signature: t=...,v1=...` to ensure authenticity and tamper-resistance.

---

## 3. Webhook Signature Verification Matrix

| Provider | Signature Header | Algorithm | Timing-Safe Compare | Secret Environment Variable |
|---|---|---|---|---|
| **Stripe** | `Stripe-Signature` | HMAC-SHA256 (`t=...,v1=...`) | ✅ `crypto.timingSafeEqual` | `STRIPE_WEBHOOK_SECRET` |
| **Twilio** | `X-Twilio-Signature` | HMAC-SHA1 | ✅ `crypto.timingSafeEqual` | `TWILIO_AUTH_TOKEN` |
| **Zapier** | `x-operza-signature` | HMAC-SHA256 (`t=...,v1=...`) | ✅ `crypto.timingSafeEqual` | `ZAPIER_CLIENT_SECRET` |
| **SendGrid** | `X-Twilio-Email-Event-Webhook-Signature` | ECDSA / HMAC | ✅ `crypto.timingSafeEqual` | `SENDGRID_WEBHOOK_KEY` |

---

## 4. Test Execution & Live Delivery Policy

### Contract Test Execution
Contract tests run automatically as part of `@operza/platform-core` test suite:
```bash
npm --workspace=@operza/platform-core test
```
All contract assertions (format validation, consent enforcement, mock receipts, signature mathematics) execute with zero network latency.

### Live Sandbox Execution
To run live external network dispatches against real staging sandbox endpoints:
```bash
export LIVE_PROVIDER_TESTS=true
export STRIPE_SECRET_KEY=sk_test_...
export TWILIO_ACCOUNT_SID=AC...
export TWILIO_AUTH_TOKEN=...
npm --workspace=@operza/platform-core test
```
When `LIVE_PROVIDER_TESTS` is unset, the suite logs:
```
NOT RUN (Requires live sandbox credentials). Set LIVE_PROVIDER_TESTS=true and configure STRIPE_TEST_KEY / TWILIO_TEST_KEY to execute live network round-trips.
```

---

## 5. Sign-Off & Verdict

| Provider | Key Format Gate | Dispatch Contract | Webhook Signature Verification | Live Status |
|---|---|---|---|---|
| Stripe | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| Twilio | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| Resend | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| SendGrid | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| Meta WhatsApp | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| Zapier | ✅ Verified | ✅ Verified | ✅ Verified | Pending Sandbox Creds |
| Overall Verdict | **CONTRACTS FULLY SPECIFIED & TESTED** | **MOCKS GREEN** | **SIGNATURES VERIFIED** | **NOT RUN (BY DESIGN)** |
