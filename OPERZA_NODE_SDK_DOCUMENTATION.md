# Operza Workflow Node SDK & Integration Framework

The Operza Node SDK provides an extensible, typed framework for defining workflow nodes, integration adapters, and custom community components.

---

## 1. Node Definition Interface

Every Operza workflow node implements the `INodeDefinition` specification:

```typescript
export interface INodeDefinition {
  /** Unique identifier, e.g. 'operza-nodes-base.httpRequest' */
  id: string;
  /** Display label in palette */
  displayName: string;
  /** High-level description of what the node does */
  description: string;
  /** Visual category in the node picker */
  category: 'Triggers' | 'Logic' | 'Transform' | 'AI & Memory' | 'CRM' | 'External APIs' | 'Database';
  /** Feather icon name or SVG token */
  icon: string;
  /** Brand color token (hex or CSS var) */
  color: string;
  /** Current semantic version */
  version: number;
  /** Input ports definition */
  inputs: Array<{
    name: string;
    type: 'main' | 'ai_memory' | 'ai_tool' | 'branch';
    displayName?: string;
  }>;
  /** Output ports definition */
  outputs: Array<{
    name: string;
    type: 'main' | 'ai_tool' | 'branch';
    displayName?: string;
  }>;
  /** Configurable user parameters */
  properties: INodeProperty[];
  /** Execution handler */
  execute(context: IExecutionContext): Promise<INodeExecutionResult>;
}

export interface INodeProperty {
  name: string;
  displayName: string;
  type: 'string' | 'number' | 'boolean' | 'options' | 'json' | 'code' | 'collection';
  default?: any;
  required?: boolean;
  options?: Array<{ name: string; value: string | number }>;
  description?: string;
  placeholder?: string;
}

export interface IExecutionContext {
  node: INodeDefinition;
  config: Record<string, any>;
  triggerContext: Record<string, any>;
  variables: Record<string, any>;
  helpers: {
    renderTemplate(template: string, ctx?: any): string;
    resolvePath(obj: any, path: string): any;
    withRetry<T>(fn: () => Promise<T>, opts?: any): Promise<T>;
    fetch(url: string, init?: any): Promise<Response>;
    getCredential(name: string): Promise<Record<string, any>>;
  };
}

export interface INodeExecutionResult {
  status: 'completed' | 'waiting' | 'waiting_approval' | 'failed';
  data?: any;
  selectedBranch?: string;
  setVariable?: { name: string; value: any };
  error?: string;
}
```

---

## 2. Standard Built-In Node Implementations

### A. Core Logic & Control Nodes
1. **`if_else` (Condition Node):**
   * Multi-rule condition evaluator matching string equals, contains, regex, numeric comparisons, empty/not-empty checks.
   * Dual output ports: `true` (green branch) and `false` (red branch).
2. **`switch` (Multi-Route Switch):**
   * Multi-branch routing with ordered conditional expressions and fallback default branch.
3. **`merge` (Data Combiner):**
   * Merges multiple parallel branch payloads into a unified context item using `combine` or `append` modes.
4. **`loop` (Batch Iteration):**
   * Iterates through collection paths (`$json.items`), processing child node sub-trees for each item with scoped `$item` and `$index`.
5. **`filter` (Array Filter):**
   * Evaluates array items against filtering predicates and outputs matching elements with optional field picking.
6. **`code` (JavaScript Sandbox):**
   * Executes custom JavaScript transformation scripts with access to `$json`, `$vars`, `$input`, and `items`.

### B. Trigger Nodes
1. **`webhook`:** Listens on `/api/webhooks/incoming/:slug` for external JSON/form payloads.
2. **`schedule`:** Cron-driven or repeating interval trigger (minutes, hours, days).
3. **`crm_event`:** Fires on native CRM mutations (contact created, opportunity won, form submitted, appointment booked).
4. **`manual`:** On-demand execution trigger directly from the visual canvas or API test suite.

### C. Native Operza CRM Nodes
1. **`create_contact` / `update_contact`:** Upserts contact records with phone/email deduplication.
2. **`add_tag` / `remove_tag`:** Manages contact tags and triggers downstream lifecycle automations.
3. **`create_task`:** Creates assignable follow-up tasks with due dates and priority levels.
4. **`create_opportunity`:** Generates pipeline deals and progresses stages in Kanban boards.
5. **`send_review_request`:** Dispatches automated SMS or email review invitations with custom feedback URLs.

### D. AI & Autonomous Nodes
1. **`ai_agent`:** Multi-step reasoning agent with autonomous tool invocation and memory buffers.
2. **`ai_model_selector`:** Connects to OpenAI, Gemini, Anthropic, or local LLMs.
3. **`rag_vector_search`:** Executes semantic retrieval against Operza Knowledge Base documents.

---

## 3. Creating a Custom Integration Node

```javascript
export const slackNotifyNode = {
  id: 'operza-nodes-base.slackNotify',
  displayName: 'Slack Notification',
  description: 'Sends messages to a Slack channel or webhook URL',
  category: 'External APIs',
  icon: 'message',
  color: '#4a154b',
  version: 1,
  properties: [
    {
      name: 'webhookUrl',
      displayName: 'Webhook URL',
      type: 'string',
      required: true,
      placeholder: 'https://hooks.slack.com/services/...'
    },
    {
      name: 'message',
      displayName: 'Message Text',
      type: 'string',
      required: true,
      description: 'Supports {{ $json.field }} expressions'
    }
  ],
  async execute(context) {
    const { config, helpers } = context;
    const url = helpers.renderTemplate(config.webhookUrl);
    const text = helpers.renderTemplate(config.message);

    const res = await helpers.fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });

    if (!res.ok) {
      throw new Error(`Slack API error: HTTP ${res.status}`);
    }

    return { status: 'completed', data: { delivered: true, text } };
  }
};
```
