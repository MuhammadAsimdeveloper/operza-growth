# Operza Clean-Room Workflow Automation & Node Registry Matrix

**Reference Baseline:** n8n Workflow Automation Architecture & Node Categories  
**Implementation Destination:** Operza Growth (`@operza/workflow-engine` and `apps/web/src/components/WorkflowCanvas.tsx`)  
**Licensing & Provenance Policy:** Clean-room implementation. Zero upstream Sustainable Use or Enterprise source copied.  
**Date:** 6 November 2026  

---

## 1. Provenance & Quarantine Declaration

The `n8n-reverse-engineering` repository serves strictly as a functional, visual, and behavioral reference. Due to upstream licensing restrictions (Sustainable Use License and Enterprise components), all code written for Operza is 100% original, authored from first principles in TypeScript, React, and Node.js ESM.

---

## 2. Node Registry Architecture & Implementation Status

| Category | Node Type | Display Name | Execution Mode | Security & Boundary Guard | Status in Operza |
|---|---|---|---|---|---|
| **Trigger** | `manual_trigger` | Manual Trigger | In-memory | Initiated by authorized workspace user | **Implemented & Tested** |
| **Trigger** | `webhook_trigger` | Inbound Webhook | API Ingress | Scoped to tenant endpoint, validated payload | **Implemented & Tested** |
| **Trigger** | `schedule_trigger` | Schedule / Cron | Timer Loop | Sliding window interval, unprivileged | **Implemented & Tested** |
| **Trigger** | `form_submission` | Form Submission | Ingress | Tied to published tenant forms | **Implemented & Tested** |
| **Trigger** | `crm_event` | CRM Event Trigger | Ingress | Contact/Deal stage transition | **Implemented & Tested** |
| **Trigger** | `calendar_event` | Appointment Booked | Ingress | Calendar booking verification | **Implemented & Tested** |
| **Logic** | `condition` / `if` | If / Else Condition | In-memory | Rule operator evaluation (equals, contains, exists) | **Implemented & Tested** |
| **Logic** | `switch` | Multi-Branch Switch | In-memory | Case evaluation against string/number values | **Implemented & Tested** |
| **Logic** | `wait` / `delay` | Wait / Delay Gate | State Machine | Scheduled delay, previewed in simulation | **Implemented & Tested** |
| **Logic** | `loop_over_items` | Loop Over Items | In-memory | Bounded batch size (1–100), max 1,000 items | **Implemented (Clean-Room)** |
| **Logic** | `split_out` | Split Out Array | In-memory | Extracts array fields into discrete items | **Implemented (Clean-Room)** |
| **Logic** | `filter_array` | Filter Items | In-memory | Safe predicate filtering without eval() | **Implemented (Clean-Room)** |
| **Logic** | `stop_and_error` | Stop & Error | State Machine | Halts execution, routes to dead-letter | **Implemented (Clean-Room)** |
| **Transform** | `edit_fields` | Edit / Set Fields | In-memory | Safe dot-notation mapping, no prototype pollution | **Implemented (Clean-Room)** |
| **Transform** | `remove_duplicates` | Remove Duplicates | In-memory | Key-based deduplication on array items | **Implemented (Clean-Room)** |
| **Transform** | `sort` | Sort Items | In-memory | Ascending/descending sort by path key | **Implemented (Clean-Room)** |
| **Transform** | `aggregate` | Aggregate Items | In-memory | Combines item fields into bounded array | **Implemented (Clean-Room)** |
| **Business** | `crm.contact.create` | Create/Update Contact | In-memory / DB | Sanitizes client injection of agency/location IDs | **Implemented & Tested** |
| **Business** | `crm.tag.add` | Apply Contact Tag | In-memory / DB | Validated tag naming, duplicate tag prevention | **Implemented & Tested** |
| **Business** | `crm.task.create` | Create Follow-up Task | In-memory / DB | Bounded dueDate and assignee resolution | **Implemented & Tested** |
| **Business** | `crm.deal.update` | Update Deal Stage | In-memory / DB | Stage transition validation | **Implemented & Tested** |
| **Governance** | `approval_gate` | Human Approval Gate | State Machine | Action-bound hash, 15-min expiry, resume recovery | **Implemented & Tested** |
| **Governance** | `copilot_proposal` | Copilot Proposal Node | Governance | Proposal drafted, review recorded, execution gated | **Implemented & Tested** |
| **External** | `send_email` | Send Email (Simulated) | Simulation | Fails closed without verified provider & consent | **Implemented (Simulation Default)** |
| **External** | `send_sms` | Send SMS (Simulated) | Simulation | Fails closed without verified provider & consent | **Implemented (Simulation Default)** |
| **External** | `direct_http_request` | Raw HTTP Request | Blocked | Direct URLs blocked to prevent SSRF | **Blocked By Policy** |

---

## 3. Workflow Canvas Capabilities

| Capability | Requirement | Operza Implementation (`WorkflowCanvas.tsx`) | Status |
|---|---|---|---|
| **2D Viewport** | Infinite pan & zoom | Native SVG viewBox matrix transform with wheel & drag | **Active** |
| **Palette & Search** | Categorized node library | Searchable node drawer with categories & icons | **Active** |
| **Port Connections** | Typed input/output ports | Visual cubic Bezier wire curves connecting ports | **Active** |
| **Branching** | Visual multi-output paths | True/False condition branches, switch multi-branches | **Active** |
| **Inspector** | Node configuration panel | Right-side inspector drawer with field-level inputs | **Active** |
| **Simulation** | Side-effect-free dry run | Preview execution highlighting traversed path | **Active** |
| **Run History** | Execution timeline | Step-by-step inspector showing timestamps and status | **Active** |
| **Approvals** | Interactive decision controls | Approve & resume / Reject controls in run inspector | **Active** |
