# End-to-End Business Journeys (Journeys A–H)

Verified in `packages/platform-core/test/cross-platform-reliability-2-0.test.mjs` against real isolated PostgreSQL (`FORCE RLS`) and core adapters:
- **Journey A (Lead -> Customer)**: Contact, Opportunity (`won`), Paid Invoice, and Conversation linked by `contact_id` in Customer 360.
- **Journey B (Customer Support)**: Ticket creation, optimistic-concurrency assignment, internal note privacy, public reply, and resolution.
- **Journey C (Marketing Automation)**: Suppression/consent evaluation (`evaluateRecipientEligibility`) blocking unsubscribed recipients.
- **Journey D (Workflow Automation)**: Execution failure classification, retry eligibility preserving `workflowVersion = 2`, and outbox idempotency.
- **Journey E (Commerce & Billing)**: Minor-unit currency-separated revenue aggregation (`aggregateCanonicalRevenueByCurrency`) and Customer 360 financial gating.
- **Journey F (Customer Portal)**: Magic-link hashing, agency binding (`MAGIC_LINK_AGENCY_MISMATCH`), and cross-customer IDOR protection (`CUSTOMER_OWNERSHIP_DENIED`).
- **Journey G (Websites & Funnels)**: Safe page schema validation (`validatePageDocument`).
- **Journey H (AI-Assisted Operations)**: Redacted context, `requiresHumanApproval: true`, `autoSend: false`, and honest `aiAvailable: false` when unconfigured.
