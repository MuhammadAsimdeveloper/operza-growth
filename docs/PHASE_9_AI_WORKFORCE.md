# Operza Phase 9: Complete 10-Agent AI Workforce & Multi-Agent Swarm

## 1. Executive Summary

Phase 9 establishes Operza's cognitive computing architecture: a **10-Agent Autonomous Business Workforce** coordinated by a central orchestrator. Unlike generic chatbots, Operza agents are domain specialists endowed with dedicated system prompts, platform route navigation knowledge, and tool execution privileges governed by strict **four-eyes human authorization**.

```
                               ┌────────────────────────────────┐
                               │    SUPERVISOR & TRIAGE AGENT   │
                               │  (Intent Analysis & Routing)   │
                               └────────────────┬───────────────┘
                                                │
         ┌──────────────┬──────────────┬────────┼──────────────┬──────────────┬──────────────┐
         ▼              ▼              ▼        ▼              ▼              ▼              ▼
     CRM Agent     Marketing      Automation  Support        Sales        Analytics     Website Builder
    (/contacts)   (/campaigns)   (/workflows) (/help)    (/opportunities)  (/kpis)        (/funnels)
         │              │              │        │              │              │              │
         └──────────────┴──────────────┼────────┴──────────────┴──────────────┴──────────────┘
                                       │
                        ┌──────────────┴──────────────┐
                        ▼                             ▼
                Integration Agent              Developer Agent
                 (/integrations)                (/developers)
```

---

## 2. The 10-Agent Specialized Team

Defined in `packages/platform-core/src/multi-agent/agents.mjs`:

| Role ID | Agent Persona | Domain & Responsibilities | Key Tool Scopes |
| :--- | :--- | :--- | :--- |
| `supervisor` | **Supervisor & Triage** | Classifies user intent, manages handoffs, synthesizes multi-agent responses | `transfer_to_agent` |
| `crm` | **CRM & Pipelines** | Contact 360, smart lists, pipeline stages, calendar bookings | `search_contacts`, `create_contact`, `update_stage` |
| `marketing` | **Marketing Strategist** | Email drip campaigns, template builder, social planner, SEO blogs | `create_campaign_proposal`, `schedule_social_post` |
| `automation` | **Workflow Engineer** | 2D visual workflows, Zapier REST hooks, loops, data filters | `generate_workflow`, `trigger_workflow`, `list_workflows` |
| `support` | **Support & Knowledge** | Platform FAQs, navigation assistance, troubleshooting, escalations | `search_knowledge_base`, `escalate_to_human` |
| `sales` | **Sales & Closer** | Quote generation, deal closing, Stripe payment links, subscriptions | `create_payment_link_proposal`, `generate_quote` |
| `analytics` | **Revenue & Analytics** | KPI dashboards, pipeline velocity, funnel conversion, audit reports | `get_kpi_dashboard`, `get_pipeline_velocity` |
| `website_builder`| **Sites & Funnels** | Landing pages, multi-page websites, checkout funnels, forms & surveys| `create_website_page_proposal`, `generate_form` |
| `integration` | **Ecosystem & Providers** | Twilio, Resend, Meta WhatsApp, Stripe, communication consent | `list_integrations`, `verify_provider_connection` |
| `developer` | **Developer Platform** | API keys, HMAC webhook signatures, PostgreSQL RLS migrations | `list_api_keys`, `generate_api_key_proposal` |

---

## 3. Four-Eyes Governance for Write Actions

All agents adhere to **fail-closed privilege boundaries**:
1. **Read Operations:** Executed immediately (e.g. searching contacts, listing workflows, calculating KPIs).
2. **Write Mutations:** Agents cannot directly mutate the database. Instead, the orchestrator generates a **Pending Proposal** registered in `state.copilotProposals` and stored with status `pending_review`.
3. **Operator Authorization:** Human operators review proposals in the **Copilot Proposals Inbox (`/copilot-inbox`)** or directly within the glassmorphic floating Copilot panel.
4. **Execution & Receipt:** Upon human approval, the mutation executes and yields an immutable **Action Receipt** (`rcpt_...`) containing an auditable cryptographic checksum.

---

## 4. Dual Local LLM Runtime Architecture

Operza operates without external AI dependencies through a cascaded local runtime (`packages/platform-core/src/llm-runtime/`):
- **Tier 1 (Local Ollama):** Communicates with local `smollm:135m` or `llama3` running on `http://localhost:11434`.
- **Tier 2 (Embedded Neural Engine):** Zero-network, embedded offline cognitive provider (`embedded-offline.mjs`). Guarantees 100% platform uptime even in air-gapped environments.
- **Polyglot Intelligence:** Natively synthesizes answers and navigation paths in English, Spanish, French, German, Urdu, Arabic, Chinese, and Japanese.

---

## 5. Verification Evidence

- `packages/platform-core/test/multi-agent.test.mjs` (All tests passing)
- End-to-End System Tests:
  - `[TEST 93] Multi-Agent Copilot SSE Stream & Public Webchat Widget` (PASSED)
  - `[TEST 94] AI Workflow Generation via Copilot Swarm & Governed Proposal Execution` (PASSED)
  - `[TEST 99] Omniscient Copilot Polyglot & Multilingual Assistance` (PASSED)
  - `[TEST 100] Real-time Copilot SSE Multi-Agent Streaming` (PASSED)
  - `[TEST 101] 10-Agent AI Workforce Handoff & Domain Swarm Resolution` (PASSED)
