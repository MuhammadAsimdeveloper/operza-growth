# @operza/workflow-engine

The core deterministic workflow execution engine for Operza. Provides high-throughput automation orchestration, step execution, condition evaluation, and human-in-the-loop safety gates.

---

## ⚙️ Architecture & Features

- **Deterministic State Machine:** Tracks execution runs through explicit lifecycle states:
  - `pending`
  - `running`
  - `waiting_approval` (Human-in-the-loop pause)
  - `completed`
  - `failed`
- **Dynamic Condition Evaluation:** Evaluates expressions against current execution payload (contact tags, opportunity value, form inputs, webhook parameters).
- **Branching Logic:** Supports complex multi-step branching (`if/else`), parallel steps, and sub-flows.
- **Human-in-the-Loop Approval Gates:** Steps designated with `requires_approval: true` pause execution, emit WebSocket events, and notify operators via the AI Copilot Hub before executing irreversible side-effects (e.g., bulk email campaigns, refunds).
- **Trigger Dispatcher:** Dispatches workflows from internal triggers (form submission, tag added, stage changed, inbound message) or external webhooks.

---

## 📦 Usage Example

```javascript
import { executeWorkflowRun } from '@operza/workflow-engine';

const workflow = {
  id: 'wf_lead_onboarding',
  nodes: [
    { id: '1', type: 'trigger', data: { event: 'form.submitted' } },
    { id: '2', type: 'condition', data: { field: 'deal_value', operator: '>', value: 1000 } },
    { id: '3', type: 'action', data: { action: 'send_sms', template: 'high_value_intro' } }
  ]
};

const run = await executeWorkflowRun(workflow, {
  contactId: 'ct_12345',
  deal_value: 2500
});
```
