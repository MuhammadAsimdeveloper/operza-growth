# Operza Growth — Workflow Engine Completion Report

## 1. Architectural Overview

The Operza Workflow Engine is a distributed, multi-tenant automation orchestrator designed to execute complex business workflows reliably.

### Subsystem Topology:
- **Visual Builder**: 14 distinct node types registered in the canvas palette.
- **AST Expression Engine**: Sandboxed evaluation of arithmetic, comparisons, string formatting, and logical conditions without `eval()`.
- **Transactional Outbox**: Outbox records are created in the same database transaction as workflow triggers (`workflow_outbox`), ensuring zero lost events.
- **Durable Worker**: Leases pending jobs with row-level locks (`FOR UPDATE SKIP LOCKED`), heartbeats active executions, and reclaims abandoned executions after timeouts.
- **Approval Gate**: Pauses workflows before sensitive external mutations (e.g. bulk emails, payments, SMS) until approved by an authorized administrator.

---

## 2. Supported Visual Builder Node Types

1. `trigger`: Enters workflow on webhook, form submission, appointment booked, or lead created.
2. `tag_contact`: Adds or removes CRM tags.
3. `create_task`: Provisions internal team follow-up tasks with due dates.
4. `send_email`: Dispatches transactional or marketing email via governed adapters.
5. `send_sms`: Dispatches text messaging via Twilio adapter with explicit consent.
6. `whatsapp`: Sends WhatsApp messaging via Meta Cloud API adapter.
7. `approval_gate`: Suspends execution, creates a review record, and awaits human decision.
8. `switch`: Conditional branch router evaluating AST rule sets.
9. `ai_classify`: Classifies incoming intent or text using AI and routes to branches.
10. `ai_extract`: Extracts structured key-value entities from unstructured messages.
11. `math`: Executes arithmetic operations on numeric fields.
12. `lead_score`: Modifies lead score points dynamically.
13. `wait_webhook`: Pauses execution and generates a unique callback resume token.
14. `webhook_respond`: Delivers synchronous HTTP responses back to the ingress caller.

---

## 3. Trusted Handlers & Outbox Engine

All event handlers are registered statically in a trusted handler registry. Dynamic code execution or arbitrary event deserialization is strictly rejected:

- `workflow.trigger.enqueued`: Claims the initial workflow run and executes step 1.
- `workflow.step.resume`: Resumes a paused execution from a specific step.
- `workflow.action.execute`: Dispatches external provider actions with consent verification.
- `crm.lead.qualified`: Handles automated promotion from prospect to qualified CRM lead.
- `zapier.event.deliver`: Dispatches outbound webhook payloads with HMAC signatures.

### Lease & Reclaim Guarantees:
- **Bounded Concurrency**: Maximum 4 concurrent executions per worker thread.
- **Crash Recovery**: Orphaned executions older than 30 seconds are reclaimed with exponential backoff.
- **Dead-Letter Transition**: Jobs failing more than 5 consecutive attempts transition to `dead_letter` status with full error context.

---

## 4. Verification Evidence

- `packages/workflow-engine/test/`: 66/66 unit and integration tests passing.
- `scripts/test-e2e.mjs`: Tests 11, 78, 79, 102, 108, and 109 verified pause/resume, approval gates, error boundaries, synchronous webhook responses, and transactional outbox correlation.
