# Operza Phase 13: App Marketplace, Zapier Platform & Developer Ecosystem

## 1. Executive Summary

Phase 13 establishes Operza's developer platform and external integration ecosystem. Combining an **App Marketplace** with native **Zapier REST Hooks** and a secure **Developer Hub**, Operza allows third-party platforms to trigger actions inside Operza and ingest real-time outbox events with cryptographic verification.

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      OPERZA DEVELOPER & ECOSYSTEM RUNTIME                         │
└───────────────────────────────────────────────────────────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  Zapier REST Hooks                Inbound Actions                 Developer Hub
 (HMAC SHA-256 Signing)           (create_contact, tag,           (API Keys, Scopes,
                                  send_notification)              cURL, Webhook Logs)
        │                                │                                │
        └────────────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          SSRF Protection Barrier      │
                     │  (Blocks 127.0.0.1, 169.254.169.254)  │
                     └───────────────────────────────────────┘
```

---

## 2. Zapier Platform Integration

- **Router:** `apps/api/zapier-router.mjs`
- **Authentication:** Bearer token authentication via tenant API keys (`/api/v1/zapier/auth/test`) returning tenant metadata and authorized scopes (`read:contacts`, `write:contacts`, `read:workflows`, etc.).
- **Dynamic Sample Generator (`performList`):** Generates schema-valid mock payloads for all trigger events during Zapier zap creation:
  - `contact.created`
  - `appointment.booked`
  - `opportunity.stage_changed`
  - `form.submitted`
- **SSRF Protection:** Webhook subscription endpoints (`/api/v1/zapier/hooks/subscribe`) validate target URLs, blocking loopback addresses (`127.0.0.1`, `localhost`), link-local IPs (`169.254.169.254`), and cloud instance metadata services before dispatching.
- **Cryptographic HMAC Signing:** Outbound REST hook events are signed with a per-subscription secret (`zhk_...`) via `crypto.createHmac('sha256', secret).update(body).digest('hex')` and passed in the `X-Operza-Signature` header.

---

## 3. Inbound Integration Actions

External systems execute authorized CRM actions via dedicated API endpoints:
- `POST /api/v1/zapier/actions/create_contact`: Provisions contacts with tags, custom fields, and email validation.
- `POST /api/v1/zapier/actions/add_tag`: Idempotently tags existing contact records, firing downstream workflow triggers.
- `POST /api/v1/zapier/actions/update_stage`: Moves opportunities across visual sales pipeline stages.
- `POST /api/v1/zapier/actions/send_notification`: Injects real-time alerts into the Operza notification center.

---

## 4. Developer Hub & API Key Governance

- **UI Interface:** `apps/web/src/pages/Developers.tsx`
- **Key Scopes:** Granular permission boundaries (`read:contacts`, `write:contacts`, `read:workflows`, `admin:keys`).
- **Secret Hygiene:** Full secret API keys are displayed only once upon generation; only truncated identifiers (`opk_live_...`) are stored in persistent views.
- **Developer Documentation (`/docs`):** In-app interactive documentation containing copy-pasteable `cURL`, Node.js, and Python code snippets.

---

## 5. Verification Evidence

- End-to-End System Tests:
  - `[TEST 92] Zapier REST Hooks Lifecycle & Inbound Actions` (PASSED)
    - Zapier auth verified with 7 scopes.
    - SSRF protection blocked `http://169.254.169.254/latest/meta-data/`.
    - HMAC signature verified on subscribed webhook.
    - Inbound `create_contact` and `add_tag` executed cleanly.
  - `[TEST 95] Lead-to-Booking Flagship Journey with Governed Zapier Delivery` (PASSED)
  - `[TEST 98] Zapier inbound notification action executed and verified in feed` (PASSED)
