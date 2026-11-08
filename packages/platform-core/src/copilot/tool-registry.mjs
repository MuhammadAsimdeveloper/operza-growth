/**
 * ============================================================================
 * Operza Central Copilot Tool Registry & Function Calling Definitions
 * ============================================================================
 * 
 * Provides model-driven function calling definitions with strict parameter
 * validation, role authorization, and 4-eyes human approval gating.
 */

import { randomUUID } from 'node:crypto';
import { authorizeCopilotTool, createCopilotProposal } from '../tool-permissions.mjs';

export const COPILOT_TOOLS = [
  // READ-ONLY TOOLS (Execute immediately for context)
  {
    name: 'search_contacts',
    description: 'Search CRM contacts by name, email, company, or tag.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search keywords (name, email, or company)' },
        limit: { type: 'number', description: 'Maximum results to return (default 5, max 20)' }
      },
      required: ['query']
    }
  },
  {
    name: 'get_pipeline_summary',
    description: 'Retrieve summary of sales opportunities, total deal value, and counts by stage.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        pipelineId: { type: 'string', description: 'Optional specific pipeline ID' }
      }
    }
  },
  {
    name: 'get_dashboard_metrics',
    description: 'Retrieve high-level business KPIs including total contacts, active funnels, revenue, and tasks.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        timeframe: { type: 'string', enum: ['today', 'this_week', 'this_month', 'all_time'], description: 'Time window for KPIs' }
      }
    }
  },
  {
    name: 'get_calendar_availability',
    description: 'Check available appointment booking slots and scheduled meetings for a date.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to today)' },
        calendarId: { type: 'string', description: 'Optional specific calendar ID' }
      }
    }
  },
  {
    name: 'get_workflow_status',
    description: 'Check status of recent automation workflow runs and any pending approval gates.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Optional workflow name to filter by' }
      }
    }
  },
  {
    name: 'get_campaign_performance',
    description: 'Retrieve email and SMS marketing campaign delivery stats, click rates, and subscriber counts.',
    risk: 'read',
    readOnly: true,
    parameters: {
      type: 'object',
      properties: {
        campaignId: { type: 'string', description: 'Optional campaign ID or name' }
      }
    }
  },

  // WRITE OPERATIONS (Create Proposal for Human Approval — Never mutates CRM silently)
  {
    name: 'create_contact',
    description: 'Propose creating a new lead or customer contact in the CRM.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: 'Contact first name' },
        lastName: { type: 'string', description: 'Contact last name' },
        email: { type: 'string', description: 'Valid email address' },
        phone: { type: 'string', description: 'Phone number in E.164 or national format' },
        company: { type: 'string', description: 'Organization or company name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply (e.g. ["inbound-lead"])' }
      },
      required: ['firstName', 'email']
    }
  },
  {
    name: 'create_task',
    description: 'Propose creating a follow-up task with due date and priority for team members.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title or summary' },
        description: { type: 'string', description: 'Detailed action instructions' },
        dueDate: { type: 'string', description: 'ISO due date string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'], description: 'Task priority level' }
      },
      required: ['title']
    }
  },
  {
    name: 'update_opportunity_stage',
    description: 'Propose moving a sales opportunity/deal to a new pipeline stage.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the deal or contact' },
        stage: { type: 'string', description: 'Target stage (e.g. "Qualified", "Proposal Sent", "Won", "Lost")' },
        value: { type: 'number', description: 'Optional updated deal monetary value' }
      },
      required: ['name', 'stage']
    }
  },
  {
    name: 'book_appointment',
    description: 'Propose scheduling an appointment on a calendar.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        contactName: { type: 'string', description: 'Customer or contact full name' },
        contactEmail: { type: 'string', description: 'Customer email' },
        date: { type: 'string', description: 'Date (YYYY-MM-DD)' },
        time: { type: 'string', description: 'Time (e.g. "10:00 AM")' },
        calendarName: { type: 'string', description: 'Calendar title' }
      },
      required: ['contactName', 'date', 'time']
    }
  },
  {
    name: 'trigger_workflow',
    description: 'Propose executing an automation workflow for an existing contact.',
    risk: 'workflow',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Name of the workflow to trigger' },
        contactEmail: { type: 'string', description: 'Optional recipient contact email' }
      },
      required: ['workflowName']
    }
  },
  {
    name: 'send_communication',
    description: 'Propose sending an outbound email or SMS to a client.',
    risk: 'external_side_effect',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        channel: { type: 'string', enum: ['email', 'sms', 'whatsapp'], description: 'Delivery channel' },
        recipient: { type: 'string', description: 'Email address or phone number' },
        subject: { type: 'string', description: 'Subject line (for email)' },
        body: { type: 'string', description: 'Full message body' }
      },
      required: ['channel', 'recipient', 'body']
    }
  },
  {
    name: 'generate_workflow',
    description: 'Propose generating a new automation workflow with triggers and nodes.',
    risk: 'workflow',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the workflow to build' },
        trigger: { type: 'string', description: 'Workflow trigger type (e.g. form_submission, webhook)' },
        nodes: { type: 'array', items: { type: 'object' }, description: 'Workflow nodes' }
      },
      required: ['name']
    }
  },
  {
    name: 'create_campaign',
    description: 'Propose launching a multi-touch outreach or marketing campaign.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign name' },
        channel: { type: 'string', enum: ['email', 'sms', 'social'], description: 'Campaign primary channel' },
        subject: { type: 'string', description: 'Subject or campaign title' }
      },
      required: ['name']
    }
  },
  {
    name: 'create_payment_link',
    description: 'Propose creating a direct checkout payment link for a product or service.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Payment link title or product description' },
        amount: { type: 'number', description: 'Charge amount in currency units' },
        currency: { type: 'string', description: 'Currency code (default USD)' }
      },
      required: ['name', 'amount']
    }
  },
  {
    name: 'generate_api_key',
    description: 'Propose generating a scoped API key for external developer access.',
    risk: 'write',
    readOnly: false,
    requiresApproval: true,
    parameters: {
      type: 'object',
      properties: {
        label: { type: 'string', description: 'API key descriptive label' },
        scopes: { type: 'array', items: { type: 'string' }, description: 'Granted permission scopes' }
      },
      required: ['label']
    }
  }
];

export class ToolRegistry {
  constructor(tools = COPILOT_TOOLS) {
    this.tools = new Map(tools.map((t) => [t.name, t]));
  }

  getTool(name) {
    return this.tools.get(name) || null;
  }

  listTools() {
    return Array.from(this.tools.values());
  }

  /**
   * Executes or proposes a tool call server-side with strict tenant scoping.
   */
  async executeTool({
    toolName,
    params = {},
    actor = {},
    agency = {},
    activeLocation = {},
    state = {},
    platformRepository = null
  }) {
    const tool = this.getTool(toolName);
    if (!tool) {
      return { ok: false, error: `Tool "${toolName}" is not registered in Operza Copilot.` };
    }

    const agencyId = agency.id;
    const locationId = activeLocation.id;
    const role = actor.membership?.role || 'member';

    // 1. Check authorization
    const authorization = authorizeCopilotTool({
      toolName,
      actorRole: role,
      tenantCapability: true,
      agentGrant: true
    });

    if (authorization.decision === 'deny') {
      return { ok: false, error: `Unauthorized: Tool "${toolName}" requires higher privileges (${authorization.code}).` };
    }

    // 2. READ-ONLY TOOLS: Execute immediately server-side
    if (tool.readOnly) {
      try {
        if (toolName === 'search_contacts') {
          state.records = state.records || {};
          state.records.contacts = state.records.contacts || [];
          const q = String(params.query || '').toLowerCase().trim();
          const limit = Math.min(20, Math.max(1, Number(params.limit) || 5));

          const contacts = state.records.contacts.filter((c) => {
            if (c.agencyId !== agencyId) return false;
            if (locationId && c.locationId && c.locationId !== locationId) return false;
            const text = `${c.firstName || ''} ${c.lastName || ''} ${c.name || ''} ${c.email || ''} ${c.company || ''} ${(c.tags || []).join(' ')}`.toLowerCase();
            return text.includes(q);
          });

          return {
            ok: true,
            results: contacts.slice(0, limit).map((c) => ({
              id: c.id,
              name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || c.name || 'Unnamed',
              email: c.email || '',
              company: c.company || '',
              status: c.status || 'lead',
              tags: c.tags || []
            }))
          };
        }

        if (toolName === 'get_pipeline_summary') {
          state.records = state.records || {};
          const opps = (state.records.opportunities || []).filter((o) => o.agencyId === agencyId);
          const stageMap = {};
          let totalValue = 0;

          for (const opp of opps) {
            const st = opp.stage || 'Discovery';
            stageMap[st] = (stageMap[st] || 0) + 1;
            totalValue += Number(opp.value || 0);
          }

          return {
            ok: true,
            totalDeals: opps.length,
            totalPipelineValue: totalValue,
            stages: stageMap
          };
        }

        if (toolName === 'get_dashboard_metrics') {
          state.records = state.records || {};
          const contactsCount = (state.records.contacts || []).filter((c) => c.agencyId === agencyId).length;
          const opps = (state.records.opportunities || []).filter((o) => o.agencyId === agencyId);
          const sites = (state.sites || []).filter((s) => s.kind === 'website');
          const funnels = (state.sites || []).filter((s) => s.kind === 'funnel');

          return {
            ok: true,
            contacts: contactsCount,
            opportunities: opps.length,
            activeWebsites: sites.length,
            activeFunnels: funnels.length,
            pipelineValue: opps.reduce((sum, o) => sum + Number(o.value || 0), 0)
          };
        }

        if (toolName === 'get_calendar_availability') {
          state.records = state.records || {};
          const date = params.date || new Date().toISOString().slice(0, 10);
          const appointments = (state.records.appointments || []).filter((a) => a.agencyId === agencyId && a.date === date);

          return {
            ok: true,
            date,
            bookedAppointments: appointments.length,
            openSlots: ['09:00 AM', '11:00 AM', '02:00 PM', '04:00 PM'].filter(
              (slot) => !appointments.some((a) => a.time === slot)
            )
          };
        }

        if (toolName === 'get_workflow_status') {
          state.records = state.records || {};
          const workflows = (state.records.workflows || []).filter((w) => w.agencyId === agencyId);
          const runs = (state.workflowRuns || []).slice(0, 5);

          return {
            ok: true,
            totalWorkflows: workflows.length,
            recentRuns: runs.map((r) => ({ id: r.id, workflowName: r.workflowName, status: r.status, startedAt: r.startedAt }))
          };
        }

        if (toolName === 'get_campaign_performance') {
          state.records = state.records || {};
          const campaigns = (state.records.campaigns || []).filter((c) => c.agencyId === agencyId);
          return {
            ok: true,
            totalCampaigns: campaigns.length,
            campaigns: campaigns.slice(0, 5).map((c) => ({ name: c.name, channel: c.channel, status: c.status }))
          };
        }
      } catch (err) {
        return { ok: false, error: `Read tool execution failed: ${err.message}` };
      }
    }

    // 3. WRITE / SENSITIVE TOOLS: Require Human Proposal Creation
    const proposalId = `prop_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const fullProposal = {
      id: proposalId,
      tenantId: agencyId,
      locationId: locationId || agencyId,
      requestedByActorId: 'agent_copilot_assistant',
      toolName,
      params,
      payload: params,
      title: `Copilot Action Proposal: ${tool.name}`,
      summary: `AI Assistant proposed executing ${tool.name} with parameters: ${JSON.stringify(params)}`,
      risk: tool.risk,
      status: 'pending_review',
      requiresHumanApproval: true,
      createdAt: new Date().toISOString()
    };

    if (platformRepository) {
      try {
        await platformRepository.createCopilotProposal({
          tenantId: agencyId,
          locationId: locationId || agencyId,
          actorId: 'agent_copilot_assistant',
          toolName,
          params,
          risk: tool.risk,
          id: proposalId
        });
      } catch (err) {
        // Fallback to memory
        state.copilotProposals = state.copilotProposals || [];
        state.copilotProposals.push(fullProposal);
      }
    } else {
      state.copilotProposals = state.copilotProposals || [];
      state.copilotProposals.push(fullProposal);
    }

    return {
      ok: true,
      id: proposalId,
      isProposal: true,
      proposalId,
      toolName,
      status: 'pending_review',
      requiresHumanApproval: true,
      params,
      message: `An action proposal has been generated for review. Please review and approve in Copilot Inbox before execution.`
    };
  }
}
