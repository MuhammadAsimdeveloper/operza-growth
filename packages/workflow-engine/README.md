# @operza/workflow-engine

The core deterministic workflow execution engine for Operza. Provides high-throughput automation orchestration, step execution, condition evaluation, and human-in-the-loop safety gates.

---

## ⚙️ Architecture & Features

- **Deterministic State Machine:** Tracks execution runs through explicit lifecycle states:
  - `pending`
  - `running`
  - `simulated` (External action prepared with side effects disabled)
  - `waiting_approval` (Human-in-the-loop pause)
  - `completed`
  - `failed`
- **Dynamic Condition Evaluation:** Evaluates expressions against current execution payload (contact tags, opportunity value, form inputs, webhook parameters).
- **Branching Logic:** Supports complex multi-step branching (`if/else`), parallel steps, and sub-flows.
- **Human-in-the-Loop Approval Gates:** Steps designated with `requires_approval: true` pause execution, emit WebSocket events, and notify operators via the AI Copilot Hub before executing irreversible side-effects (e.g., bulk email campaigns, refunds).
- **Trigger Dispatcher:** Dispatches workflows from internal triggers (form submission, tag added, stage changed, inbound message) or external webhooks.

- **Governed external actions:** Email, SMS and review-request nodes default to simulation. They do not call local logging stubs or claim a provider send occurred.
- **Live dispatch boundary:** Live external actions require a verified provider, explicit consent, action-bound approval and a trusted server-injected provider executor. No provider is enabled by this package alone.
- **Network safety:** Direct workflow URL nodes (webhook, http_request, slack_notify) fail closed until a connector-scoped egress implementation is configured.
- **Approval evidence:** Approval checksums protect against accidental mutation, but production approval evidence must be loaded from trusted server-side persistence and bound to the immutable execution action.

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
