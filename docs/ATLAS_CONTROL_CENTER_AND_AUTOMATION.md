# Atlas and Operza automation foundation

This document records the first clean-room automation capabilities added to the unified Operza workspace.

## Atlas Desktop Control Center

The workspace overview follows the supplied Atlas Desktop Control Center layout and remains part of the existing Operza application:

- Compact Atlas control-plane navigation routes into the existing CRM, conversations, automation, integrations, growth, AI, knowledge, and revenue modules.
- Dashboard metrics are derived from workspace records and recent execution data. No sample KPI values from the design are hard-coded.
- Approval counts remain unknown when the server does not return a reliable queue result.
- Add Contact and Create Opportunity shortcuts open the existing creation dialogs.
- Ask Atlas opens the existing Copilot panel.

## Workflow portability

Operza now supports a versioned native package format:

`operza.workflow`, version `1`.

The package includes workflow trigger, supported actions, and condition branches. Export and import are bounded and validated:

- Maximum package size: 1 MB.
- Maximum workflow nodes: 200.
- Maximum branch nesting depth: 8.
- Imports receive new workflow and action IDs, reset enrollment counters, and always start as drafts.
- Only the existing Operza trigger and action types are accepted.
- Credential-like fields, unsafe property names, embedded URL credentials, secret-like query parameters, unsupported nodes, malformed branches, and invalid configurations are rejected.

A package contains configuration, not provider credentials. Import does not publish or execute a workflow.

## Template library

The existing local template research was reviewed for concepts that fit Operza's current node and safety model. A native webhook lead-validation template was added using a webhook trigger, an email-field condition, local tags, and follow-up tasks. It does not copy upstream n8n implementation code, execute imported JavaScript, or send to an external provider.

## Not yet implemented

These capabilities are intentionally not represented as live features yet:

- Arbitrary Code nodes or unrestricted Node.js/Python execution.
- LangChain/AI Agent, memory, vector retrieval, or model execution inside workflows.
- General-purpose HTTP Request, arbitrary outbound webhook dispatch, or social/chat provider nodes.
- SQLite/database connector nodes and split-in-batches processors.
- Durable wait queues, worker retries, idempotency, and resumable approvals.
- Direct import of arbitrary n8n exports. The current package format is Operza-native.

These require separate connector, sandbox, credential vault, policy, queue, and execution work. The workflow engine's existing Atlas approval and external-action governance remains the control layer for future capabilities.

## Durable approval lifecycle — Phase 2

The workflow execution API now persists human approval state and resumes approved runs from the exact paused node.

- `state.workflowApprovals` stores the approval request, decision evidence, requester, approver, tenant, location, workflow and execution references, node ID, action hash, timestamps and expiry.
- Each execution keeps a private versioned `workflowSnapshot` and `currentNodeIndex`. The API does not return the snapshot, raw trigger payload, action hash or approval evidence to the browser.
- Pending approvals are listed at `GET /api/workflows/approvals`.
- `POST /api/workflows/runs/:id/approve` accepts an action-bound decision and resumes the same execution from the paused node. `POST /api/workflows/runs/:id/reject` terminates the run without executing the paused action.
- A node approval is consumed after that node. It cannot authorize the next node. Expired approvals fail closed; repeated decisions return a conflict.
- Runs left in the saved `resuming` state are recovered during application startup.

**Important storage and reliability limit:** records currently use the existing atomic JSON / PostgreSQL application-state snapshot. This is durable for the single application process, but is not a normalized approval table or transactional outbox. Multi-worker locking, transactional action receipts and provider-level idempotency remain open work. No live provider is enabled, and a successful approval alone does not mean that an email, SMS, review request or payment was sent.

