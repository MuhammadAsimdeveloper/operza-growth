/**
 * Operza Copilot — Secure Tool Execution Framework
 * Defines the complete tool registry with JSON Schema, RBAC permissions,
 * safety classifications (read / write_reversible / write_sensitive), and real handlers.
 */

import { randomUUID } from 'crypto';

export const TOOL_REGISTRY = {
  // ==========================================
  // CRM TOOLS
  // ==========================================
  crm_search_contacts: {
    id: 'crm_search_contacts',
    name: 'Search Contacts',
    category: 'crm',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Search CRM contacts by name, email, phone number, company, or tags.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term for name, email, phone, or company' },
        limit: { type: 'number', description: 'Maximum number of results to return (default 10)' }
      },
      required: ['query']
    },
    execute: async ({ query, limit = 10 }, { agency, activeLocation }, state) => {
      const q = String(query || '').toLowerCase().trim();
      const contacts = (state.records.contacts || []).filter(
        c => c.agencyId === agency.id && c.locationId === activeLocation.id
      );

      const results = contacts.filter(c => {
        if (!q) return true;
        return [c.firstName, c.lastName, c.email, c.phone, c.company, ...(c.tags || [])]
          .some(v => String(v || '').toLowerCase().includes(q));
      }).slice(0, Math.min(limit, 50));

      return {
        count: results.length,
        contacts: results.map(c => ({
          id: c.id,
          name: `${c.firstName || ''} ${c.lastName || ''}`.trim() || 'Unnamed',
          email: c.email || 'No email',
          phone: c.phone || 'No phone',
          company: c.company || 'Direct',
          tags: c.tags || [],
          status: c.status || 'lead'
        }))
      };
    }
  },

  crm_create_contact: {
    id: 'crm_create_contact',
    name: 'Create Contact',
    category: 'crm',
    classification: 'write_reversible',
    requiredPermission: 'write:crm',
    description: 'Add a new verified contact or lead to the agency CRM.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name or company representative name' },
        email: { type: 'string', description: 'Valid email address' },
        phone: { type: 'string', description: 'E.164 phone number' },
        company: { type: 'string', description: 'Company or business name' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags to apply' }
      },
      required: ['name']
    },
    execute: async (params, actor, state, { saveState, auditLog, broadcast }) => {
      const nameParts = (params.name || 'New Lead').trim().split(/\s+/);
      const firstName = nameParts[0] || 'New';
      const lastName = nameParts.slice(1).join(' ') || '';

      const contact = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        firstName,
        lastName,
        email: (params.email || '').trim().toLowerCase(),
        phone: (params.phone || '').trim(),
        company: (params.company || '').trim(),
        tags: Array.isArray(params.tags) ? params.tags : ['copilot-lead'],
        status: 'lead',
        source: 'Operza Copilot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.contacts = state.records.contacts || [];
      state.records.contacts.unshift(contact);
      await saveState();

      auditLog('crm.contact.created', actor, { contactId: contact.id, source: 'ai_copilot' });
      broadcast('crm.contacts.created', contact);

      return {
        success: true,
        contactId: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
        company: contact.company,
        tags: contact.tags
      };
    }
  },

  crm_find_duplicates: {
    id: 'crm_find_duplicates',
    name: 'Find Duplicate Contacts',
    category: 'crm',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Scan CRM records to identify duplicate contacts sharing the same email or phone number.',
    parameters: { type: 'object', properties: {} },
    execute: async (_params, { agency, activeLocation }, state) => {
      const contacts = (state.records.contacts || []).filter(
        c => c.agencyId === agency.id && c.locationId === activeLocation.id
      );

      const emailMap = new Map();
      const phoneMap = new Map();
      const duplicateClusters = [];

      for (const c of contacts) {
        if (c.email) {
          const list = emailMap.get(c.email) || [];
          list.push(c);
          emailMap.set(c.email, list);
        }
        if (c.phone) {
          const cleanPhone = c.phone.replace(/\D/g, '');
          if (cleanPhone.length >= 7) {
            const list = phoneMap.get(cleanPhone) || [];
            list.push(c);
            phoneMap.set(cleanPhone, list);
          }
        }
      }

      for (const [email, list] of emailMap.entries()) {
        if (list.length > 1) {
          duplicateClusters.push({
            reason: `Matching email: ${email}`,
            count: list.length,
            records: list.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), company: c.company }))
          });
        }
      }

      for (const [phone, list] of phoneMap.entries()) {
        if (list.length > 1) {
          duplicateClusters.push({
            reason: `Matching phone digits: ${phone}`,
            count: list.length,
            records: list.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim(), email: c.email }))
          });
        }
      }

      return {
        totalContactsScanned: contacts.length,
        duplicateClustersFound: duplicateClusters.length,
        clusters: duplicateClusters.slice(0, 10)
      };
    }
  },

  crm_search_opportunities: {
    id: 'crm_search_opportunities',
    name: 'Search Opportunities',
    category: 'crm',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Query deals in the sales pipeline by name, stage, or value threshold.',
    parameters: {
      type: 'object',
      properties: {
        stage: { type: 'string', description: 'Filter by stage name (e.g., Qualified, Proposal, Won)' },
        minValue: { type: 'number', description: 'Minimum deal value in USD' }
      }
    },
    execute: async (params, { agency, activeLocation }, state) => {
      const opps = (state.records.opportunities || []).filter(
        o => o.agencyId === agency.id && o.locationId === activeLocation.id
      );

      const filtered = opps.filter(o => {
        if (params.stage && String(o.stage).toLowerCase() !== String(params.stage).toLowerCase()) return false;
        if (params.minValue && Number(o.value || 0) < Number(params.minValue)) return false;
        return true;
      });

      return {
        count: filtered.length,
        totalValue: filtered.reduce((s, o) => s + (Number(o.value) || 0), 0),
        opportunities: filtered.slice(0, 15).map(o => ({
          id: o.id,
          name: o.name,
          value: Number(o.value) || 0,
          stage: o.stage,
          status: o.status
        }))
      };
    }
  },

  crm_create_opportunity: {
    id: 'crm_create_opportunity',
    name: 'Create Opportunity / Deal',
    category: 'crm',
    classification: 'write_reversible',
    requiredPermission: 'write:crm',
    description: 'Add a new sales opportunity to the pipeline with deal name, value, and stage.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the deal or client project' },
        value: { type: 'number', description: 'Monetary value of the deal in USD' },
        stage: { type: 'string', description: 'Pipeline stage (default: Qualified)' },
        contactId: { type: 'string', description: 'Associated contact ID' }
      },
      required: ['name', 'value']
    },
    execute: async (params, actor, state, { saveState, auditLog, broadcast }) => {
      const opp = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        name: params.name || 'New Opportunity',
        value: Number(params.value) || 0,
        stage: params.stage || 'Qualified',
        contactId: params.contactId || null,
        status: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.opportunities = state.records.opportunities || [];
      state.records.opportunities.unshift(opp);
      await saveState();

      auditLog('crm.opportunity.created', actor, { opportunityId: opp.id, value: opp.value });
      broadcast('crm.opportunities.created', opp);

      return {
        success: true,
        opportunityId: opp.id,
        name: opp.name,
        value: opp.value,
        stage: opp.stage
      };
    }
  },

  crm_update_opportunity_stage: {
    id: 'crm_update_opportunity_stage',
    name: 'Update Opportunity Stage',
    category: 'crm',
    classification: 'write_reversible',
    requiredPermission: 'write:crm',
    description: 'Move an opportunity to a different stage in the sales pipeline.',
    parameters: {
      type: 'object',
      properties: {
        opportunityId: { type: 'string', description: 'Exact opportunity ID' },
        name: { type: 'string', description: 'Partial name match if ID not known' },
        stage: { type: 'string', description: 'Target pipeline stage (e.g., Won, Lost, Proposal)' }
      },
      required: ['stage']
    },
    execute: async (params, actor, state, { saveState, auditLog, broadcast }) => {
      state.records.opportunities = state.records.opportunities || [];
      const opp = state.records.opportunities.find(o =>
        o.agencyId === actor.agency.id &&
        o.locationId === actor.activeLocation.id &&
        ((params.opportunityId && o.id === params.opportunityId) ||
         (params.name && o.name.toLowerCase().includes(params.name.toLowerCase())))
      );

      if (!opp) throw new Error('Target opportunity not found');

      const prevStage = opp.stage;
      opp.stage = params.stage;
      if (params.stage.toLowerCase() === 'won') opp.status = 'won';
      if (params.stage.toLowerCase() === 'lost') opp.status = 'lost';
      opp.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('crm.opportunity.stage_changed', actor, { id: opp.id, from: prevStage, to: opp.stage });
      broadcast('crm.opportunities.updated', opp);

      return {
        success: true,
        opportunityId: opp.id,
        name: opp.name,
        previousStage: prevStage,
        newStage: opp.stage,
        status: opp.status
      };
    }
  },

  crm_create_task: {
    id: 'crm_create_task',
    name: 'Create Task',
    category: 'crm',
    classification: 'write_reversible',
    requiredPermission: 'write:crm',
    description: 'Create an actionable reminder or follow-up task for a team member.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task description or objective' },
        dueDate: { type: 'string', description: 'ISO due date string' },
        priority: { type: 'string', enum: ['low', 'medium', 'high', 'urgent'] }
      },
      required: ['title']
    },
    execute: async (params, actor, state, { saveState, broadcast }) => {
      const task = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        title: params.title,
        dueDate: params.dueDate || new Date(Date.now() + 86400000).toISOString(),
        priority: params.priority || 'medium',
        assignedTo: actor.user.name,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.tasks = state.records.tasks || [];
      state.records.tasks.unshift(task);
      await saveState();
      broadcast('crm.tasks.created', task);

      return {
        success: true,
        taskId: task.id,
        title: task.title,
        dueDate: task.dueDate
      };
    }
  },

  // ==========================================
  // CALENDAR TOOLS
  // ==========================================
  calendar_check_availability: {
    id: 'calendar_check_availability',
    name: 'Check Calendar Availability',
    category: 'calendar',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Inspect calendar booking availability and existing appointments for a specific date.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date in YYYY-MM-DD format (defaults to today)' }
      }
    },
    execute: async ({ date }, { agency, activeLocation }, state) => {
      const targetDate = date || new Date().toISOString().slice(0, 10);
      const appts = (state.records.appointments || []).filter(a =>
        a.agencyId === agency.id &&
        a.locationId === activeLocation.id &&
        a.startsAt && a.startsAt.startsWith(targetDate)
      );

      return {
        date: targetDate,
        bookedAppointmentsCount: appts.length,
        appointments: appts.map(a => ({
          id: a.id,
          title: a.title,
          contactName: a.contactName || 'Client',
          startsAt: a.startsAt,
          status: a.status
        }))
      };
    }
  },

  calendar_create_appointment: {
    id: 'calendar_create_appointment',
    name: 'Book Appointment',
    category: 'calendar',
    classification: 'write_sensitive', // Sensitive action: books calendar slot
    requiredPermission: 'write:crm',
    description: 'Schedule a new confirmed appointment on the agency calendar.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Meeting topic or appointment title' },
        contactName: { type: 'string', description: 'Client or contact attendee name' },
        startsAt: { type: 'string', description: 'ISO timestamp for start time' }
      },
      required: ['title', 'startsAt']
    },
    execute: async (params, actor, state, { saveState, auditLog, broadcast }) => {
      const appt = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        title: params.title,
        contactName: params.contactName || '',
        startsAt: params.startsAt,
        endsAt: new Date(new Date(params.startsAt).getTime() + 3600000).toISOString(),
        status: 'confirmed',
        assignedTo: actor.user.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.appointments = state.records.appointments || [];
      state.records.appointments.push(appt);
      await saveState();

      auditLog('crm.appointment.created', actor, { appointmentId: appt.id, startsAt: appt.startsAt });
      broadcast('crm.appointments.created', appt);

      return {
        success: true,
        appointmentId: appt.id,
        title: appt.title,
        startsAt: appt.startsAt
      };
    }
  },

  // ==========================================
  // CONVERSATIONS & COMMUNICATION TOOLS
  // ==========================================
  conversations_search: {
    id: 'conversations_search',
    name: 'Search Conversations',
    category: 'conversations',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Search client communication threads across SMS, Email, and WhatsApp channels.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term or contact name' }
      }
    },
    execute: async ({ query = '' }, { agency, activeLocation }, state) => {
      const convs = (state.records.conversations || []).filter(
        c => c.agencyId === agency.id && c.locationId === activeLocation.id
      );

      const q = query.toLowerCase().trim();
      const filtered = convs.filter(c => {
        if (!q) return true;
        return (c.contactName && c.contactName.toLowerCase().includes(q)) ||
               (c.lastMessage && c.lastMessage.toLowerCase().includes(q));
      });

      return {
        count: filtered.length,
        threads: filtered.slice(0, 10).map(c => ({
          id: c.id,
          contactName: c.contactName || 'Lead',
          channel: c.channel,
          lastMessage: c.lastMessage,
          status: c.status
        }))
      };
    }
  },

  conversations_send_message: {
    id: 'conversations_send_message',
    name: 'Send Outbound Message',
    category: 'conversations',
    classification: 'write_sensitive', // Sensitive action: external outbound communication
    requiredPermission: 'write:messages',
    description: 'Dispatch an outbound message (SMS, Email, or WhatsApp) to a client contact.',
    parameters: {
      type: 'object',
      properties: {
        recipient: { type: 'string', description: 'Contact name, phone, or email' },
        channel: { type: 'string', enum: ['sms', 'email', 'whatsapp'] },
        message: { type: 'string', description: 'Full body of the text or email' }
      },
      required: ['recipient', 'channel', 'message']
    },
    execute: async (params, actor, state, { saveState, auditLog, broadcast }) => {
      const channel = params.channel.toLowerCase();
      const contact = (state.records.contacts || []).find(c =>
        c.agencyId === actor.agency.id &&
        (c.email?.toLowerCase().includes(params.recipient.toLowerCase()) ||
         c.phone?.includes(params.recipient) ||
         `${c.firstName} ${c.lastName}`.toLowerCase().includes(params.recipient.toLowerCase()))
      );

      const messageRecord = {
        id: randomUUID(),
        sender: 'agent',
        senderName: `Copilot (${actor.user.name})`,
        channel,
        content: params.message,
        timestamp: new Date().toISOString()
      };

      state.records.conversations = state.records.conversations || [];
      let conv = state.records.conversations.find(c =>
        c.agencyId === actor.agency.id &&
        c.locationId === actor.activeLocation.id &&
        (contact ? c.contactId === contact.id : true)
      );

      if (conv) {
        conv.messages = conv.messages || [];
        conv.messages.push(messageRecord);
        conv.lastMessage = messageRecord.content;
        conv.updatedAt = new Date().toISOString();
      } else {
        conv = {
          id: randomUUID(),
          agencyId: actor.agency.id,
          locationId: actor.activeLocation.id,
          contactId: contact?.id || null,
          contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : params.recipient,
          channel,
          status: 'open',
          messages: [messageRecord],
          lastMessage: messageRecord.content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
      }

      await saveState();
      auditLog('crm.communication.sent', actor, { channel, recipient: params.recipient });
      broadcast('crm.conversations.updated', { conversationId: conv.id, message: messageRecord });

      return {
        success: true,
        channel,
        recipient: conv.contactName,
        message: messageRecord.content
      };
    }
  },

  // ==========================================
  // MARKETING TOOLS
  // ==========================================
  marketing_summarize_campaigns: {
    id: 'marketing_summarize_campaigns',
    name: 'Summarize Campaigns',
    category: 'marketing',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Retrieve marketing campaign statistics, audience sizes, and delivery statuses.',
    parameters: { type: 'object', properties: {} },
    execute: async (_params, { agency, activeLocation }, state) => {
      const campaigns = (state.records.campaigns || []).filter(
        c => c.agencyId === agency.id && c.locationId === activeLocation.id
      );

      return {
        totalCampaigns: campaigns.length,
        activeCampaigns: campaigns.filter(c => c.status === 'active' || c.status === 'published').length,
        campaigns: campaigns.slice(0, 10).map(c => ({
          id: c.id,
          name: c.name,
          channel: c.channel || 'email',
          status: c.status,
          audienceCount: c.audienceCount || c.contacts?.length || 0
        }))
      };
    }
  },

  marketing_create_campaign_draft: {
    id: 'marketing_create_campaign_draft',
    name: 'Create Campaign Draft',
    category: 'marketing',
    classification: 'write_reversible',
    requiredPermission: 'write:crm',
    description: 'Draft a new outbound marketing campaign in draft status.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Campaign title' },
        channel: { type: 'string', enum: ['email', 'sms'] },
        subject: { type: 'string', description: 'Email subject or SMS header' },
        body: { type: 'string', description: 'Content body' }
      },
      required: ['name', 'channel']
    },
    execute: async (params, actor, state, { saveState, auditLog }) => {
      const campaign = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        name: params.name,
        channel: params.channel,
        subject: params.subject || '',
        body: params.body || '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.campaigns = state.records.campaigns || [];
      state.records.campaigns.unshift(campaign);
      await saveState();

      auditLog('crm.campaign.draft_created', actor, { campaignId: campaign.id, name: campaign.name });

      return {
        success: true,
        campaignId: campaign.id,
        name: campaign.name,
        status: 'draft'
      };
    }
  },

  // ==========================================
  // WORKFLOW & AUTOMATION TOOLS
  // ==========================================
  workflows_list: {
    id: 'workflows_list',
    name: 'List Workflows',
    category: 'workflows',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Retrieve automated visual workflows and inspection metrics.',
    parameters: { type: 'object', properties: {} },
    execute: async (_params, { agency, activeLocation }, state) => {
      const flows = (state.records.workflows || []).filter(
        w => w.agencyId === agency.id && w.locationId === activeLocation.id
      );

      return {
        total: flows.length,
        active: flows.filter(f => f.status === 'active' || f.status === 'published').length,
        workflows: flows.map(f => ({
          id: f.id,
          name: f.name,
          status: f.status,
          triggerType: f.triggerType || f.trigger?.kind || 'manual',
          enrolledCount: f.enrolled || 0
        }))
      };
    }
  },

  workflows_trigger_execution: {
    id: 'workflows_trigger_execution',
    name: 'Trigger Workflow Execution',
    category: 'workflows',
    classification: 'write_sensitive', // Sensitive action: executes production workflow
    requiredPermission: 'execute:workflow',
    description: 'Execute an automated workflow graph instance with execution state tracking.',
    parameters: {
      type: 'object',
      properties: {
        workflowName: { type: 'string', description: 'Name of the workflow to run' },
        workflowId: { type: 'string', description: 'Unique workflow ID if known' }
      },
      required: ['workflowName']
    },
    execute: async (params, actor, state, { auditLog, executeWorkflowInstance }) => {
      state.records.workflows = state.records.workflows || [];
      const flow = state.records.workflows.find(w =>
        w.agencyId === actor.agency.id &&
        w.locationId === actor.activeLocation.id &&
        ((params.workflowId && w.id === params.workflowId) ||
         (params.workflowName && w.name.toLowerCase().includes(params.workflowName.toLowerCase())))
      );

      if (!flow) throw new Error(`Workflow matching '${params.workflowName}' not found`);

      const execution = await executeWorkflowInstance({
        flow,
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        triggerType: 'manual',
        triggerContext: {
          manualTrigger: true,
          triggeredBy: `Copilot (${actor.user.name})`
        }
      });

      auditLog('workflow.execution_triggered', actor, { workflowId: flow.id, executionId: execution.id });

      return {
        success: true,
        workflowId: flow.id,
        workflowName: flow.name,
        executionId: execution.id,
        status: execution.status,
        stepsExecuted: execution.steps?.length || 0
      };
    }
  },

  // ==========================================
  // REPORTING & KPI TOOLS
  // ==========================================
  reporting_agency_metrics: {
    id: 'reporting_agency_metrics',
    name: 'Agency Performance Metrics',
    category: 'reporting',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Compile an authoritative KPI summary covering contacts, deals, workflows, and integrations.',
    parameters: { type: 'object', properties: {} },
    execute: async (_params, { agency, activeLocation }, state) => {
      const ag = agency.id;
      const loc = activeLocation.id;
      const contacts = (state.records.contacts || []).filter(c => c.agencyId === ag && c.locationId === loc);
      const opps = (state.records.opportunities || []).filter(o => o.agencyId === ag && o.locationId === loc);
      const tasks = (state.records.tasks || []).filter(t => t.agencyId === ag && t.locationId === loc);
      const flows = (state.records.workflows || []).filter(w => w.agencyId === ag && w.locationId === loc);
      const totalValue = opps.reduce((s, o) => s + (Number(o.value) || 0), 0);
      const wonValue = opps.filter(o => o.status === 'won').reduce((s, o) => s + (Number(o.value) || 0), 0);
      const integrations = state.records.integrations?.[ag] || [];

      return {
        totalContacts: contacts.length,
        totalOpportunities: opps.length,
        pipelineValue: totalValue,
        wonValue,
        activeWorkflows: flows.filter(f => f.status === 'active' || f.status === 'published').length,
        pendingTasks: tasks.filter(t => t.status !== 'completed').length,
        connectedIntegrationsCount: integrations.filter(i => i.connected).length
      };
    }
  },

  reporting_revenue_summary: {
    id: 'reporting_revenue_summary',
    name: 'Revenue & Invoicing Summary',
    category: 'reporting',
    classification: 'read',
    requiredPermission: 'read:crm',
    description: 'Calculate billed invoices, paid receipts, and conversion totals.',
    parameters: { type: 'object', properties: {} },
    execute: async (_params, { agency, activeLocation }, state) => {
      const invoices = (state.records.invoices || []).filter(
        i => i.agencyId === agency.id && i.locationId === activeLocation.id
      );

      const totalInvoiced = invoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const paidInvoices = invoices.filter(i => i.status === 'paid');
      const paidTotal = paidInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);

      return {
        totalInvoicesCount: invoices.length,
        paidInvoicesCount: paidInvoices.length,
        totalInvoicedAmount: totalInvoiced,
        totalCollectedRevenue: paidTotal,
        collectionRate: totalInvoiced > 0 ? Math.round((paidTotal / totalInvoiced) * 100) : 100
      };
    }
  }
};

/**
 * Validates whether an actor has sufficient permissions to run a tool.
 */
export function checkToolPermission(tool, actor) {
  const userRole = actor?.user?.role || 'user';
  if (userRole === 'owner' || userRole === 'admin') return true;

  // Viewers cannot execute mutation tools
  if (userRole === 'viewer') {
    return tool.classification === 'read';
  }

  // Standard user cannot execute sensitive actions without explicit admin grant
  if (tool.classification === 'write_sensitive') {
    return userRole === 'admin' || userRole === 'owner';
  }

  return true;
}
