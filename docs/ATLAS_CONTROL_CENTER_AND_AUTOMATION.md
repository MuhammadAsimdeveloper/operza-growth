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
