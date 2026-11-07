# Operza Phase 10: Advanced Visual Workflow Builder & Flow Control Engine

## 1. Executive Summary

Phase 10 delivers complete visual workflow automation with dedicated flow control nodes, seamlessly integrated into Operza's CRM, omnichannel telephony, and commerce modules. Operators design, test, and orchestrate complex multi-branch business graphs using an intuitive **2D node-and-wire visual designer** (`apps/web/src/pages/Workflows.tsx`).

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                      OPERZA 2D VISUAL AUTOMATION CANVAS                           │
└───────────────────────────────────────────────────────────────────────────────────┘
                                         │
        ┌────────────────────────────────┼────────────────────────────────┐
        ▼                                ▼                                ▼
  Event Triggers                    Flow & Logic                     Action Nodes
 (Form, Tag, Webhook,             (Loop, Filter, Switch,            (Email, SMS, WhatsApp,
  Cron, Error Boundary)            Condition, Sub-Workflow)          Zapier, Payment Link)
        │                                │                                │
        └────────────────────────────────┼────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │    Single-Node Interactive Testing    │
                     │  (POST /workflows/:id/nodes/:nid/test)│
                     └───────────────────────────────────────┘
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │    Durable Outbox Execution Machine   │
                     │  (Status, Attempts, Lease & Timeline) │
                     └───────────────────────────────────────┘
```

---

## 2. Comprehensive Node Library

| Node Kind | Category | Functionality & Configuration Parameters |
| :--- | :--- | :--- |
| `loop_items` | **Iteration** | Iterates over arrays in configurable batches (`batchSize: 2`, `concurrency: 1`). Avoids rate limits when processing lead lists. |
| `data_filter` | **Data Transformation** | Filters collections by rule expressions (`equals`, `contains`, `greater_than`, `less_than`, `exists`). |
| `split_test` | **Optimization** | Splits execution paths according to weighted traffic percentages (e.g. 50/50 A/B split). |
| `set_variable` | **Context** | Computes and sets dynamic workflow context variables accessible to downstream nodes. |
| `math` | **Computation** | Evaluates mathematical calculations (`add`, `subtract`, `multiply`, `divide`, `modulo`, `round`). |
| `lead_score` | **CRM Mutation** | Increments or decrements contact lead scores based on behavioral engagements. |
| `internal_notification` | **Alerting** | Dispatches real-time in-app alerts, bell notifications, or audio pings to agency operators. |
| `sub_workflow` | **Modularity** | Invokes reusable child workflows, passing execution context and receiving transformed output. |
| `zapier` | **Ecosystem** | Dispatches HMAC-signed webhooks to external Zapier REST hooks with replay protection. |
| `code` | **Extensibility** | Executes sandboxed JavaScript transformations with `input` and `context` objects. |
| `error_trigger` | **Resilience** | Catches unhandled node failures, automatically routing execution to dedicated error boundary handlers. |
| `switch` | **Routing** | Evaluates target variable and routes flow to one of $N$ matching branches. |
| `condition` | **Branching** | Evaluates boolean if/else condition rules on contact fields, tags, or custom values. |
| `wait` | **Timing** | Pauses workflow for specified minutes, hours, or days, resumed by the scheduler tick loop. |

---

## 3. Interactive Single-Node Step Testing

Operza features isolated single-node step testing:
- **Endpoint:** `POST /api/workflows/:id/nodes/:nodeId/test`
- **Capability:** Allows operators to test individual nodes in isolation with sample context before publishing the entire graph.
- **Node-Specific Logic:**
  - `ai_classify`: Evaluates lead intent classification against defined categories.
  - `code`: Sandboxes custom JavaScript code and verifies returned output structure.
  - `switch`: Validates which branch will be selected based on simulated variables.

---

## 4. Execution Timeline & Step Result Inspection

- **Timeline Drawer:** Clicking any execution in the **Recent Executions** table opens the **Run Result Drawer**.
- **Inspection Attributes:**
  - Step status (`completed`, `simulated`, `waiting_approval`, `failed`).
  - Duration in milliseconds per node.
  - JSON output preview (e.g. classification intent, computed math values, Zapier webhook payload).
  - Correlated Outbox Job ID and attempt metrics.

---

## 5. Verification Evidence

- `@operza/workflow-engine` Unit Tests: 48 / 48 passing
- End-to-End System Tests:
  - `[TEST 90] Interactive Single-Node Step Testing` (PASSED)
  - `[TEST 91] Workflow Run Step Timeline` (PASSED)
  - `[TEST 96] Modular Sub-Workflow Invocation & Timed Delay Resumption` (PASSED)
  - `[TEST 97] Advanced Flow Automation: Loop Over Items & Data Filtering` (PASSED)
  - `[TEST 98] Resilient Error Trigger & Workflow Failure Boundary` (PASSED)
  - `[TEST 103] Advanced Workflow Builder: 2D Canvas Node Palette & Schema Integrity` (PASSED)
