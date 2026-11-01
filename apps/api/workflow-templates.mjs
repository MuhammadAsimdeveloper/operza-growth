/**
 * ============================================================================
 * Operza Workflow Templates Engine (Extracted from n8n-reverse-engineering)
 * ============================================================================
 * Provides pre-built, production-grade workflow automation templates
 * for rapid 1-click importation into the visual workflow canvas.
 */

export const WORKFLOW_CATEGORIES = [
  { id: 1, name: 'AI & Autonomous Agents', slug: 'ai', icon: 'sparkles' },
  { id: 2, name: 'Webhooks & APIs', slug: 'webhooks', icon: 'webhook' },
  { id: 3, name: 'Data Transformation', slug: 'transform', icon: 'code' },
  { id: 4, name: 'Core Automation', slug: 'automation', icon: 'sliders' },
  { id: 5, name: 'Communication & Alerts', slug: 'communication', icon: 'mail' },
  { id: 6, name: 'Database & Sync', slug: 'database', icon: 'database' }
];

export const WORKFLOW_COLLECTIONS = [
  {
    id: 1,
    name: 'Operza AI & Autonomous Agents',
    description: 'Autonomous multi-step reasoning agents, RAG vector retrieval, and memory buffers',
    workflowIds: ['tpl_ai_agent', 'tpl_bot_router']
  },
  {
    id: 2,
    name: 'Core Automations & Cloud APIs',
    description: 'Essential webhook handlers, service health checkers, and cron schedulers',
    workflowIds: ['tpl_webhook_ingest', 'tpl_health_check', 'tpl_daily_summary']
  },
  {
    id: 3,
    name: 'Data Pipelines & Storage Sync',
    description: 'Database transformers, batch splitters, and data cleaners',
    workflowIds: ['tpl_db_sync']
  }
];

export const RAW_TEMPLATES = [
  {
    id: 'tpl_ai_agent',
    name: 'Multi-Step AI Autonomous Agent with Reasoning & Tools',
    description: 'Autonomous reasoning agent equipped with conversational memory buffer, math calculation tool, and automated lead intelligence lookup.',
    totalViews: 3420,
    category: 'AI & Autonomous Agents',
    categoryId: 1,
    trigger: {
      kind: 'webhook',
      unit: 'minutes',
      interval: 1
    },
    actions: [
      {
        id: 'act_ai_1',
        kind: 'ai_agent',
        label: 'AI Reasoning Agent',
        config: {
          model: 'gemini-1.5-pro',
          systemPrompt: 'You are an intelligent agency operations copilot. Analyze incoming contact data, qualify lead intent, and recommend next actions.',
          temperature: 0.2
        }
      },
      {
        id: 'act_ai_2',
        kind: 'code',
        label: 'Format AI Recommendations',
        config: {
          code: 'return items.map(item => ({\n  json: {\n    ...item.json,\n    qualified: true,\n    score: 95,\n    analyzedAt: new Date().toISOString()\n  }\n}));'
        }
      },
      {
        id: 'act_ai_3',
        kind: 'condition',
        label: 'If High Intent Lead',
        config: {
          rule: {
            field: 'status',
            operator: 'is',
            value: 'lead'
          }
        },
        yes: [
          {
            id: 'act_ai_yes',
            kind: 'tag',
            label: 'Tag VIP Qualified Lead',
            config: { tag: 'vip-qualified' }
          }
        ],
        no: [
          {
            id: 'act_ai_no',
            kind: 'task',
            label: 'Schedule Lead Review Task',
            config: { taskTitle: 'Manual lead review needed' }
          }
        ]
      }
    ],
    nodes: [
      { id: 'n1', name: 'Chat Webhook Trigger', kind: 'webhook', type: 'trigger', x: 80, y: 180 },
      { id: 'n2', name: 'AI Reasoning Agent', kind: 'ai_agent', type: 'action', x: 340, y: 180 },
      { id: 'n3', name: 'Memory Buffer', kind: 'ai_agent', type: 'sub_action', x: 340, y: 340 },
      { id: 'n4', name: 'Format Output', kind: 'code', type: 'action', x: 600, y: 180 },
      { id: 'n5', name: 'Intent Branching', kind: 'condition', type: 'action', x: 860, y: 180 }
    ]
  },
  {
    id: 'tpl_webhook_ingest',
    name: 'Webhook Ingestion, Schema Validator & Data Filter',
    description: 'Receives external HTTP POST webhooks, validates incoming payloads, filters records, and outputs normalized contact records.',
    totalViews: 2890,
    category: 'Webhooks & APIs',
    categoryId: 2,
    trigger: {
      kind: 'webhook',
      unit: 'minutes',
      interval: 1
    },
    actions: [
      {
        id: 'act_wh_1',
        kind: 'code',
        label: 'Validate Inbound Schema',
        config: {
          code: 'if (!$json.email) {\n  throw new Error("Missing required field: email");\n}\nreturn [{ json: { ...$json, normalizedEmail: $json.email.toLowerCase().trim() } }];'
        }
      },
      {
        id: 'act_wh_2',
        kind: 'tag',
        label: 'Apply Ingress Tag',
        config: { tag: 'api-webhook-ingest' }
      },
      {
        id: 'act_wh_3',
        kind: 'task',
        label: 'Create Intake Task',
        config: { taskTitle: 'Follow up with webhook contact' }
      }
    ],
    nodes: [
      { id: 'n1', name: 'HTTP Webhook', kind: 'webhook', type: 'trigger', x: 80, y: 200 },
      { id: 'n2', name: 'Validate Schema', kind: 'code', type: 'action', x: 340, y: 200 },
      { id: 'n3', name: 'Tag Contact', kind: 'tag', type: 'action', x: 600, y: 200 },
      { id: 'n4', name: 'Create Intake Task', kind: 'task', type: 'action', x: 860, y: 200 }
    ]
  },
  {
    id: 'tpl_health_check',
    name: 'Scheduled Service Health Monitor & Uptime Alerts',
    description: 'Periodically polls HTTP microservice endpoints, records uptime metrics, and triggers alerts on degradation.',
    totalViews: 1950,
    category: 'Core Automation',
    categoryId: 4,
    trigger: {
      kind: 'schedule',
      unit: 'hours',
      interval: 1
    },
    actions: [
      {
        id: 'act_hc_1',
        kind: 'webhook',
        label: 'HTTP Ping /ready Endpoint',
        config: {
          url: 'http://localhost:4000/ready',
          method: 'GET'
        }
      },
      {
        id: 'act_hc_2',
        kind: 'code',
        label: 'Evaluate Latency & Status',
        config: {
          code: 'const healthy = ($json.status === "ok" || $json.statusCode === 200);\nreturn [{ json: { status: healthy ? "HEALTHY" : "DEGRADED", checkedAt: new Date().toISOString() } }];'
        }
      },
      {
        id: 'act_hc_3',
        kind: 'email',
        label: 'Alert Team on Downtime',
        config: {
          to: 'devops@operza.io',
          subject: 'Operza Service Status Alert',
          body: 'Automated health checker observed system status change.'
        }
      }
    ],
    nodes: [
      { id: 'n1', name: 'Hourly Schedule', kind: 'schedule', type: 'trigger', x: 80, y: 200 },
      { id: 'n2', name: 'HTTP Health Ping', kind: 'webhook', type: 'action', x: 340, y: 200 },
      { id: 'n3', name: 'Evaluate Latency', kind: 'code', type: 'action', x: 600, y: 200 },
      { id: 'n4', name: 'Notify Team', kind: 'email', type: 'action', x: 860, y: 200 }
    ]
  },
  {
    id: 'tpl_db_sync',
    name: 'Database Table Sync & Records Transformer',
    description: 'Extracts rows from PostgreSQL/SQLite stores, applies data transformations, and batches record synchronizations.',
    totalViews: 1640,
    category: 'Database & Sync',
    categoryId: 6,
    trigger: {
      kind: 'schedule',
      unit: 'days',
      interval: 1
    },
    actions: [
      {
        id: 'act_db_1',
        kind: 'code',
        label: 'Query & Transform Records',
        config: {
          code: 'return items.map((item, index) => ({\n  json: {\n    ...item.json,\n    batchIndex: index,\n    syncTimestamp: Date.now()\n  }\n}));'
        }
      },
      {
        id: 'act_db_2',
        kind: 'webhook',
        label: 'Dispatch Synced Records',
        config: {
          url: 'http://localhost:4000/api/developers/webhooks/test',
          method: 'POST'
        }
      }
    ],
    nodes: [
      { id: 'n1', name: 'Daily Cron', kind: 'schedule', type: 'trigger', x: 80, y: 200 },
      { id: 'n2', name: 'Transform Rows', kind: 'code', type: 'action', x: 360, y: 200 },
      { id: 'n3', name: 'Sync Ingress', kind: 'webhook', type: 'action', x: 640, y: 200 }
    ]
  },
  {
    id: 'tpl_bot_router',
    name: 'Intelligent Conversational Bot & Intent Router',
    description: 'Webhook-driven conversational bot that routes customer messages, executes custom logic, and returns instant replies.',
    totalViews: 2410,
    category: 'Communication & Alerts',
    categoryId: 5,
    trigger: {
      kind: 'webhook',
      unit: 'minutes',
      interval: 1
    },
    actions: [
      {
        id: 'act_bot_1',
        kind: 'code',
        label: 'Parse Intent & Keywords',
        config: {
          code: 'const msg = String($json.message || "").toLowerCase();\nconst isPricing = msg.includes("pricing") || msg.includes("cost");\nreturn [{ json: { intent: isPricing ? "PRICING" : "GENERAL", raw: msg } }];'
        }
      },
      {
        id: 'act_bot_2',
        kind: 'switch',
        label: 'Route by Customer Intent',
        config: {
          cases: [
            { id: 'c1', label: 'Pricing Query', value: 'PRICING' },
            { id: 'c2', label: 'General Support', value: 'GENERAL' }
          ]
        }
      },
      {
        id: 'act_bot_3',
        kind: 'sms',
        label: 'Send Immediate Automated Reply',
        config: {
          message: 'Hello! Thanks for contacting us. We have received your message and will assist you shortly.'
        }
      }
    ],
    nodes: [
      { id: 'n1', name: 'Inbound Webhook', kind: 'webhook', type: 'trigger', x: 80, y: 200 },
      { id: 'n2', name: 'Parse Intent', kind: 'code', type: 'action', x: 340, y: 200 },
      { id: 'n3', name: 'Switch Route', kind: 'switch', type: 'action', x: 600, y: 200 },
      { id: 'n4', name: 'Send SMS Reply', kind: 'sms', type: 'action', x: 860, y: 200 }
    ]
  },
  {
    id: 'tpl_daily_summary',
    name: 'Daily Executive Summary & Operations Aggregator',
    description: 'Runs every morning, compiles metrics across opportunities, contacts, and invoices, and formats an executive summary.',
    totalViews: 1780,
    category: 'Core Automation',
    categoryId: 4,
    trigger: {
      kind: 'schedule',
      unit: 'days',
      interval: 1
    },
    actions: [
      {
        id: 'act_ds_1',
        kind: 'code',
        label: 'Aggregate Revenue & Pipeline Metrics',
        config: {
          code: 'return [{ json: { date: new Date().toLocaleDateString(), health: "100%", pipelineStatus: "Active", uptime: "99.98%" } }];'
        }
      },
      {
        id: 'act_ds_2',
        kind: 'email',
        label: 'Send Daily Digest to Leadership',
        config: {
          to: 'agency-owner@operza.io',
          subject: 'Daily Operations Digest — Operza',
          body: 'Daily agency operations summary has been compiled successfully.'
        }
      }
    ],
    nodes: [
      { id: 'n1', name: 'Morning 8 AM Schedule', kind: 'schedule', type: 'trigger', x: 80, y: 200 },
      { id: 'n2', name: 'Aggregate Metrics', kind: 'code', type: 'action', x: 360, y: 200 },
      { id: 'n3', name: 'Email Daily Digest', kind: 'email', type: 'action', x: 640, y: 200 }
    ]
  }
];
