/**
 * ============================================================================
 * Operza Zapier Integration Router & REST Hooks Subsystem
 * ============================================================================
 * 
 * Implements the full Zapier CLI / Developer Platform specification:
 * 1. Authentication Endpoint (/api/v1/zapier/auth/me)
 * 2. Complete App Definition & Manifest (/api/v1/zapier/app-definition & /schema)
 * 3. Triggers, Actions, and Searches Introspection Endpoints
 * 4. REST Hook Subscription Lifecycle (/api/v1/zapier/hooks/subscribe, unsubscribe, list, test)
 * 5. Outbound HMAC-SHA256 Signed Event Dispatcher with Replay Defense
 * 6. Polling Triggers Fallback (/api/v1/zapier/polls/:event)
 * 7. 4 Inbound Searches (/api/v1/zapier/searches/:searchKey)
 * 8. 12 Inbound Actions (/api/v1/zapier/actions/:actionKey)
 * 9. Real-Time Delivery Log & Observability (/api/v1/zapier/deliveries)
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { authorizeZapierRequest } from './zapier-authz.mjs';
import { assertPublicWebhookTarget, postWebhookWithPinnedDns } from '../../packages/platform-core/src/zapier-worker-handler.mjs';

/**
 * Validates whether a target webhook URL is safe for outbound dispatch.
 * Enforces HTTPS, strips userinfo credentials, and blocks RFC 1918 private subnets,
 * loopback, link-local, cloud metadata, and DNS rebinding wildcard domains.
 * @param {string} url
 * @returns {boolean}
 */
export function isSafeWebhookUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    // Reject userinfo (e.g. credentials embedded in URL)
    if (parsed.username || parsed.password) return false;

    const hostname = parsed.hostname.toLowerCase().trim();
    if (!hostname) return false;

    // Reject loopback and unroutable / internal hostnames
    if (
      hostname === 'localhost' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.internal') ||
      hostname.endsWith('.nip.io') ||
      hostname.endsWith('.localtest.me') ||
      hostname === 'metadata.google.internal' ||
      hostname === 'instance-data'
    ) {
      return false;
    }

    // Check for IPv4 addresses and private/loopback/link-local CIDR blocks
    const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const o1 = Number(ipv4Match[1]);
      const o2 = Number(ipv4Match[2]);
      const o3 = Number(ipv4Match[3]);
      const o4 = Number(ipv4Match[4]);
      if (o1 > 255 || o2 > 255 || o3 > 255 || o4 > 255) return false;
      // Loopback 127.0.0.0/8
      if (o1 === 127) return false;
      // Current network 0.0.0.0/8
      if (o1 === 0) return false;
      // Private 10.0.0.0/8
      if (o1 === 10) return false;
      // Private 172.16.0.0/12 (172.16 - 172.31)
      if (o1 === 172 && o2 >= 16 && o2 <= 31) return false;
      // Private 192.168.0.0/16
      if (o1 === 192 && o2 === 168) return false;
      // Link-local / Cloud metadata 169.254.0.0/16
      if (o1 === 169 && o2 === 254) return false;
      // Broadcast / Multicast
      if (o1 >= 224) return false;
    }

    // Check for IPv6 addresses
    if (hostname.startsWith('[') || hostname.includes(':')) {
      const cleanIpv6 = hostname.replace(/^\[|\]$/g, '').toLowerCase();
      if (
        cleanIpv6 === '::1' ||
        cleanIpv6 === '::' ||
        cleanIpv6.startsWith('fe80:') ||
        cleanIpv6.startsWith('fc') ||
        cleanIpv6.startsWith('fd') ||
        cleanIpv6.includes('::ffff:127.')
      ) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the full Zapier Developer App Definition / CLI schema manifest.
 * @returns {object}
 */
export function getZapierAppDefinition() {
  return {
    version: '2.5.0',
    platformVersion: '15.0.0',
    title: 'Operza',
    description: 'Unified Business Operating System combining CRM, visual workflow automation, omnichannel communications, funnels, calendars, and AI Copilot.',
    authentication: {
      type: 'custom',
      test: '/api/v1/zapier/auth/me',
      fields: [
        {
          key: 'apiKey',
          label: 'API Key / Bearer Token',
          required: true,
          type: 'string',
          helpText: 'Generate your personal access API key in Operza -> Settings -> API Keys.'
        }
      ]
    },
    triggers: [
      {
        key: 'contact_created',
        noun: 'Contact',
        display: { label: 'New Contact', description: 'Triggers when a new contact or lead is created in Operza.' },
        operation: { type: 'hook', event: 'contact.created', performList: '/api/v1/zapier/samples/contact.created' }
      },
      {
        key: 'contact_updated',
        noun: 'Contact',
        display: { label: 'Updated Contact', description: 'Triggers when an existing contact details or tags are modified.' },
        operation: { type: 'hook', event: 'contact.updated', performList: '/api/v1/zapier/samples/contact.updated' }
      },
      {
        key: 'opportunity_created',
        noun: 'Opportunity',
        display: { label: 'New Opportunity', description: 'Triggers when a new deal or sales pipeline opportunity is created.' },
        operation: { type: 'hook', event: 'opportunity.created', performList: '/api/v1/zapier/samples/opportunity.created' }
      },
      {
        key: 'opportunity_stage_changed',
        noun: 'Opportunity',
        display: { label: 'Opportunity Stage Changed', description: 'Triggers when an opportunity moves across sales pipeline stages.' },
        operation: { type: 'hook', event: 'opportunity.stage_changed', performList: '/api/v1/zapier/samples/opportunity.stage_changed' }
      },
      {
        key: 'appointment_booked',
        noun: 'Appointment',
        display: { label: 'New Appointment Scheduled', description: 'Triggers when an appointment is booked on an Operza calendar.' },
        operation: { type: 'hook', event: 'appointment.booked', performList: '/api/v1/zapier/samples/appointment.booked' }
      },
      {
        key: 'appointment_cancelled',
        noun: 'Appointment',
        display: { label: 'Appointment Cancelled', description: 'Triggers when an appointment is cancelled or removed.' },
        operation: { type: 'hook', event: 'appointment.cancelled', performList: '/api/v1/zapier/samples/appointment.cancelled' }
      },
      {
        key: 'form_submitted',
        noun: 'Submission',
        display: { label: 'New Form Submission', description: 'Triggers when a lead completes a public form, quiz, or survey.' },
        operation: { type: 'hook', event: 'form.submitted', performList: '/api/v1/zapier/samples/form.submitted' }
      },
      {
        key: 'payment_received',
        noun: 'Payment',
        display: { label: 'Payment Received', description: 'Triggers when a payment or product purchase completes successfully.' },
        operation: { type: 'hook', event: 'payment.received', performList: '/api/v1/zapier/samples/payment.received' }
      },
      {
        key: 'invoice_paid',
        noun: 'Invoice',
        display: { label: 'Invoice Paid', description: 'Triggers when an invoice is marked as paid in full.' },
        operation: { type: 'hook', event: 'invoice.paid', performList: '/api/v1/zapier/samples/invoice.paid' }
      },
      {
        key: 'task_created',
        noun: 'Task',
        display: { label: 'New Task Created', description: 'Triggers when a task is created or assigned to a team member.' },
        operation: { type: 'hook', event: 'task.created', performList: '/api/v1/zapier/samples/task.created' }
      },
      {
        key: 'call_completed',
        noun: 'Call',
        display: { label: 'Call Session Completed', description: 'Triggers when an inbound or outbound softphone call session terminates.' },
        operation: { type: 'hook', event: 'call.completed', performList: '/api/v1/zapier/samples/call.completed' }
      },
      {
        key: 'tag_added',
        noun: 'Tag',
        display: { label: 'Tag Added to Contact', description: 'Triggers when a specific tag is applied to a contact.' },
        operation: { type: 'hook', event: 'tag.added', performList: '/api/v1/zapier/samples/tag.added' }
      },
      {
        key: 'workflow_completed',
        noun: 'Workflow',
        display: { label: 'Workflow Run Completed', description: 'Triggers when an automated workflow finishes execution.' },
        operation: { type: 'hook', event: 'workflow.completed', performList: '/api/v1/zapier/samples/workflow.completed' }
      },
      {
        key: 'notification_created',
        noun: 'Notification',
        display: { label: 'New Team Notification', description: 'Triggers when an alert is issued to the notification center.' },
        operation: { type: 'hook', event: 'notification.created', performList: '/api/v1/zapier/samples/notification.created' }
      }
    ],
    searches: [
      {
        key: 'find_contact',
        noun: 'Contact',
        display: { label: 'Find Contact', description: 'Search for an existing contact by email, phone, or name.' },
        operation: {
          perform: '/api/v1/zapier/searches/find_contact',
          inputFields: [
            { key: 'email', label: 'Email', type: 'string' },
            { key: 'phone', label: 'Phone Number', type: 'string' },
            { key: 'id', label: 'Contact ID', type: 'string' }
          ]
        }
      },
      {
        key: 'find_opportunity',
        noun: 'Opportunity',
        display: { label: 'Find Opportunity', description: 'Search for an opportunity deal by contact email or title.' },
        operation: {
          perform: '/api/v1/zapier/searches/find_opportunity',
          inputFields: [
            { key: 'contactEmail', label: 'Contact Email', type: 'string' },
            { key: 'name', label: 'Deal Title', type: 'string' },
            { key: 'id', label: 'Opportunity ID', type: 'string' }
          ]
        }
      },
      {
        key: 'find_appointment',
        noun: 'Appointment',
        display: { label: 'Find Appointment', description: 'Search for an existing appointment by contact name or date.' },
        operation: {
          perform: '/api/v1/zapier/searches/find_appointment',
          inputFields: [
            { key: 'contactName', label: 'Contact Name', type: 'string' },
            { key: 'date', label: 'Date (YYYY-MM-DD)', type: 'string' },
            { key: 'id', label: 'Appointment ID', type: 'string' }
          ]
        }
      },
      {
        key: 'find_task',
        noun: 'Task',
        display: { label: 'Find Task', description: 'Search for a task by title or assignee.' },
        operation: {
          perform: '/api/v1/zapier/searches/find_task',
          inputFields: [
            { key: 'title', label: 'Task Title', type: 'string' },
            { key: 'assignedTo', label: 'Assigned User', type: 'string' },
            { key: 'id', label: 'Task ID', type: 'string' }
          ]
        }
      }
    ],
    creates: [
      {
        key: 'create_contact',
        noun: 'Contact',
        display: { label: 'Create or Update Contact', description: 'Create a new contact in Operza or update by email/phone.' },
        operation: { perform: '/api/v1/zapier/actions/create_contact' }
      },
      {
        key: 'update_contact',
        noun: 'Contact',
        display: { label: 'Update Contact', description: 'Update specific fields on an existing contact.' },
        operation: { perform: '/api/v1/zapier/actions/update_contact' }
      },
      {
        key: 'create_opportunity',
        noun: 'Opportunity',
        display: { label: 'Create Opportunity', description: 'Create a new deal opportunity in a pipeline.' },
        operation: { perform: '/api/v1/zapier/actions/create_opportunity' }
      },
      {
        key: 'update_opportunity',
        noun: 'Opportunity',
        display: { label: 'Update Opportunity', description: 'Change pipeline stage, value, or status of a deal.' },
        operation: { perform: '/api/v1/zapier/actions/update_opportunity' }
      },
      {
        key: 'create_appointment',
        noun: 'Appointment',
        display: { label: 'Create Appointment', description: 'Schedule a confirmed booking on an Operza calendar.' },
        operation: { perform: '/api/v1/zapier/actions/create_appointment' }
      },
      {
        key: 'create_task',
        noun: 'Task',
        display: { label: 'Create Task', description: 'Create a CRM task with priority and due date.' },
        operation: { perform: '/api/v1/zapier/actions/create_task' }
      },
      {
        key: 'add_tag',
        noun: 'Tag',
        display: { label: 'Add Tag to Contact', description: 'Apply a tag to an existing contact.' },
        operation: { perform: '/api/v1/zapier/actions/add_tag' }
      },
      {
        key: 'remove_tag',
        noun: 'Tag',
        display: { label: 'Remove Tag from Contact', description: 'Remove a specific tag from a contact.' },
        operation: { perform: '/api/v1/zapier/actions/remove_tag' }
      },
      {
        key: 'create_note',
        noun: 'Note',
        display: { label: 'Add Note to Contact', description: 'Log a conversation note or internal CRM activity.' },
        operation: { perform: '/api/v1/zapier/actions/create_note' }
      },
      {
        key: 'send_communication',
        noun: 'Message',
        display: { label: 'Send Communication', description: 'Dispatch an SMS or Email through Operza.' },
        operation: { perform: '/api/v1/zapier/actions/send_communication' }
      },
      {
        key: 'trigger_workflow',
        noun: 'Workflow',
        display: { label: 'Trigger Workflow', description: 'Execute an Operza automation workflow on-demand.' },
        operation: { perform: '/api/v1/zapier/actions/trigger_workflow' }
      },
      {
        key: 'send_notification',
        noun: 'Notification',
        display: { label: 'Send In-App Notification', description: 'Push a team alert to the Operza Notification Center.' },
        operation: { perform: '/api/v1/zapier/actions/send_notification' }
      }
    ]
  };
}

/**
 * Generates sample records for Zapier field mapping (performList).
 * @param {string} event
 * @param {object} [existingRecords]
 * @returns {Array<object>}
 */
export function getZapierSamples(event, existingRecords = {}) {
  const now = new Date().toISOString();
  switch (event) {
    case 'contact.created':
    case 'contact.updated': {
      const contacts = existingRecords.contacts || [];
      if (contacts.length > 0) {
        return contacts.slice(0, 3).map(c => ({
          id: c.id,
          firstName: c.firstName || 'Sarah',
          lastName: c.lastName || 'Connor',
          email: c.email || 'sarah@skynet-defense.com',
          phone: c.phone || '+1 555-0199',
          company: c.company || 'Cyberdyne Systems',
          tags: c.tags || ['inbound-lead'],
          status: c.status || 'lead',
          createdAt: c.createdAt || now
        }));
      }
      return [
        {
          id: 'con_sample_01',
          firstName: 'Sarah',
          lastName: 'Connor',
          email: 'sarah@skynet-defense.com',
          phone: '+1 555-0199',
          company: 'Cyberdyne Systems',
          tags: ['enterprise', 'vip-lead'],
          status: 'lead',
          createdAt: now
        }
      ];
    }

    case 'opportunity.created':
    case 'opportunity.stage_changed': {
      const opps = existingRecords.opportunities || [];
      if (opps.length > 0) {
        return opps.slice(0, 3).map(o => ({
          id: o.id,
          name: o.name || 'Enterprise Automation Deployment',
          value: o.value || 50000,
          stage: o.stage || 'Proposal Sent',
          previousStage: 'Discovery Call Booked',
          status: o.status || 'open',
          contactEmail: o.contactEmail || 'sarah@skynet-defense.com',
          updatedAt: o.updatedAt || now
        }));
      }
      return [
        {
          id: 'opp_sample_01',
          name: 'Cyberdyne Annual SaaS Retainer',
          value: 125000,
          stage: 'Proposal Sent',
          previousStage: 'Discovery Call Booked',
          status: 'open',
          contactEmail: 'sarah@skynet-defense.com',
          updatedAt: now
        }
      ];
    }

    case 'appointment.booked':
    case 'appointment.cancelled': {
      const apts = existingRecords.appointments || [];
      if (apts.length > 0) {
        return apts.slice(0, 3).map(a => ({
          id: a.id,
          title: a.title || 'Discovery & Architecture Consultation',
          calendarName: a.calendarName || 'Executive Strategy Calendar',
          contactName: a.contactName || 'Sarah Connor',
          contactEmail: a.contactEmail || 'sarah@skynet-defense.com',
          startsAt: a.startsAt || new Date(Date.now() + 86400000).toISOString(),
          status: a.status || (event === 'appointment.cancelled' ? 'cancelled' : 'confirmed')
        }));
      }
      return [
        {
          id: 'apt_sample_01',
          title: 'Discovery & Architecture Consultation',
          calendarName: 'Executive Strategy Calendar',
          contactName: 'Sarah Connor',
          contactEmail: 'sarah@skynet-defense.com',
          startsAt: new Date(Date.now() + 86400000).toISOString(),
          status: event === 'appointment.cancelled' ? 'cancelled' : 'confirmed'
        }
      ];
    }

    case 'tag.added': {
      return [
        {
          contactId: 'con_sample_01',
          email: 'sarah@skynet-defense.com',
          tag: 'ai-qualified',
          addedAt: now
        }
      ];
    }

    case 'form.submitted': {
      return [
        {
          formId: 'form_enterprise_contact',
          formName: 'Inbound Enterprise Demo Request',
          contactEmail: 'sarah@skynet-defense.com',
          submittedAt: now,
          answers: {
            budget: '$50,000+',
            timeline: 'Immediate',
            companySize: '250-500'
          }
        }
      ];
    }

    case 'payment.received': {
      return [
        {
          orderId: 'ORD-982104',
          invoiceId: 'INV-982104',
          amount: 5000,
          currency: 'usd',
          contactEmail: 'sarah@skynet-defense.com',
          status: 'paid',
          paidAt: now
        }
      ];
    }

    case 'invoice.paid': {
      return [
        {
          invoiceId: 'INV-839201',
          invoiceNumber: 'INV-839201',
          amount: 1500,
          currency: 'usd',
          contactEmail: 'sarah@skynet-defense.com',
          status: 'paid',
          paidAt: now
        }
      ];
    }

    case 'task.created': {
      return [
        {
          id: 'task_sample_01',
          title: 'Prepare Custom Enterprise SLA Proposal',
          priority: 'high',
          assignedTo: 'Lead Account Executive',
          dueDate: new Date(Date.now() + 86400000 * 2).toISOString(),
          status: 'pending',
          createdAt: now
        }
      ];
    }

    case 'call.completed': {
      return [
        {
          id: 'call_sample_01',
          to: '+15553219876',
          from: '+18005550199',
          durationSec: 142,
          outcome: 'completed',
          contactName: 'Sarah Connor',
          endedAt: now
        }
      ];
    }

    case 'workflow.completed': {
      return [
        {
          workflowId: 'wf_sample_01',
          workflowName: 'Enterprise Inbound Lead Triage',
          executionId: 'exec_sample_01',
          status: 'completed',
          stepsExecuted: 5,
          completedAt: now
        }
      ];
    }

    case 'notification.created': {
      return [
        {
          id: 'notif_sample_01',
          title: 'High-Value Prospect Activity',
          message: 'Contact reached 50 points threshold',
          channel: 'in_app',
          read: false,
          createdAt: now
        }
      ];
    }

    default:
      return [
        {
          id: 'evt_sample_01',
          event: event || 'custom.event',
          timestamp: now,
          payload: { status: 'success', sample: true }
        }
      ];
  }
}

/**
 * Dispatches an event to all active Zapier REST Hook subscribers for a tenant.
 * @param {object} params
 * @returns {Promise<Array<object>>}
 */
export async function dispatchZapierEvent({ agencyId, locationId, event, data, state, zapierRepository, fetchFn = globalThis.fetch }) {
  if (!agencyId || !event) return [];
  if (zapierRepository) {
    const subscriptions = await zapierRepository.listSubscriptions({ tenantId: agencyId, locationId });
    return Promise.all(subscriptions.filter(sub => sub.event === event && sub.status === 'active').map(sub =>
      zapierRepository.enqueueEvent({ tenantId: agencyId, locationId, subscriptionId: sub.id, event, data })
    ));
  }
  if (!state) return [];
  state.zapierHookSubscriptions = state.zapierHookSubscriptions || [];
  state.zapierHookDeliveries = state.zapierHookDeliveries || [];

  const subscriptions = state.zapierHookSubscriptions.filter(
    s => s.agencyId === agencyId && (!locationId || s.locationId === locationId) && s.event === event && s.status === 'active'
  );

  const results = [];
  const timestamp = Math.floor(Date.now() / 1000);

  for (const sub of subscriptions) {
    const deliveryId = `deliv_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const payload = {
      event,
      deliveryId,
      timestamp,
      subscriptionId: sub.id,
      data
    };

    const signature = createHmac('sha256', sub.signingSecret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');

    let httpStatus = 0;
    let responseBody = '';
    let success = false;

    try {
      const res = await fetchFn(sub.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Operza-Signature': `t=${timestamp},v1=${signature}`,
          'X-Operza-Event': event,
          'X-Operza-Delivery-Id': deliveryId
        },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(10_000)
      });
      httpStatus = res.status;
      success = res.ok;
      // Do not persist arbitrary third-party response text; it may contain secrets or PII.
      if (res.status === 410 || res.status === 404) {
        sub.status = 'deactivated';
        sub.deactivationReason = 'TARGET_GONE_OR_NOT_FOUND';
      } else if (!res.ok) {
        sub.consecutiveFailures = (sub.consecutiveFailures || 0) + 1;
        if (sub.consecutiveFailures >= 5) {
          sub.status = 'deactivated';
          sub.deactivationReason = 'CONSECUTIVE_DELIVERY_FAILURES';
        }
      } else {
        sub.consecutiveFailures = 0;
      }
    } catch (err) {
      httpStatus = 500;
      responseBody = 'Webhook delivery request failed';
      sub.consecutiveFailures = (sub.consecutiveFailures || 0) + 1;
      if (sub.consecutiveFailures >= 5) {
        sub.status = 'deactivated';
        sub.deactivationReason = 'CONSECUTIVE_DELIVERY_FAILURES';
      }
    }

    const deliveryRecord = {
      id: deliveryId,
      subscriptionId: sub.id,
      agencyId,
      locationId: sub.locationId,
      event,
      payload,
      httpStatus,
      responseBody: '',
      delivered: success,
      deliveredAt: new Date().toISOString()
    };
    state.zapierHookDeliveries.unshift(deliveryRecord);
    if (state.zapierHookDeliveries.length > 200) state.zapierHookDeliveries.length = 200;
    results.push(deliveryRecord);
  }

  return results;
}

/**
 * Handles incoming Zapier HTTP requests.
 * @param {object} req Incoming HTTP request
 * @param {object} res Outgoing HTTP response
 * @param {object} context Shared server context
 * @returns {Promise<boolean>} Whether request was handled
 */
export async function handleZapierRoute(req, res, {
  method,
  pathname,
  actor,
  agency,
  activeLocation,
  state,
  saveState,
  sendJson,
  readBody,
  executeWorkflowInstance,
  broadcast,
  zapierRepository,
  secretResolver,
  sendWebhook = postWebhookWithPinnedDns,
  fetchFn = globalThis.fetch
}) {
  if (!pathname.startsWith('/api/v1/zapier/')) return false;

  const authorization = authorizeZapierRequest({ method, pathname, actor });
  if (!authorization.allowed) {
    return sendJson(res, 403, {
      error: 'The API key does not have permission to perform this Zapier operation',
      code: 'API_KEY_SCOPE_REQUIRED',
      requiredScope: authorization.requiredScope
    });
  }

  // 1. Authentication Check (/api/v1/zapier/auth/me)
  if (method === 'GET' && pathname === '/api/v1/zapier/auth/me') {
    return sendJson(res, 200, {
      valid: true,
      tenantId: agency.id,
      locationId: activeLocation.id,
      agencyName: agency.name,
      userEmail: actor.user.email,
      // Report the grants actually attached to this developer key. Never advertise
      // permissions that the token does not possess.
      scopes: actor.isApiKey && Array.isArray(actor.apiKey?.scopes)
        ? [...new Set(actor.apiKey.scopes.filter(scope => typeof scope === 'string'))]
        : []
    });
  }

  // 2. Complete Zapier App Schema & Manifest Introspection (/api/v1/zapier/app-definition or /schema)
  if (method === 'GET' && (pathname === '/api/v1/zapier/app-definition' || pathname === '/api/v1/zapier/schema')) {
    const appDef = getZapierAppDefinition();
    return sendJson(res, 200, appDef);
  }

  // 3. Triggers, Actions, and Searches Catalog Endpoints
  if (method === 'GET' && pathname === '/api/v1/zapier/triggers') {
    return sendJson(res, 200, getZapierAppDefinition().triggers);
  }
  if (method === 'GET' && pathname === '/api/v1/zapier/actions') {
    return sendJson(res, 200, getZapierAppDefinition().creates);
  }
  if (method === 'GET' && pathname === '/api/v1/zapier/searches') {
    return sendJson(res, 200, getZapierAppDefinition().searches);
  }

  // 4. REST Hook Subscriptions List
  if (method === 'GET' && pathname === '/api/v1/zapier/hooks') {
    if (zapierRepository) {
      const subscriptions = await zapierRepository.listSubscriptions({ tenantId: agency.id, locationId: activeLocation.id });
      return sendJson(res, 200, { success: true, subscriptions: subscriptions.map(s => ({
        id:s.id,event:s.event,targetUrl:s.target_url,status:s.status,createdAt:s.created_at,
        consecutiveFailures:s.consecutive_failures||0
      })) });
    }
    state.zapierHookSubscriptions=state.zapierHookSubscriptions||[];
    const subscriptions=state.zapierHookSubscriptions.filter(s=>s.agencyId===agency.id&&s.locationId===activeLocation.id);
    return sendJson(res,200,{success:true,subscriptions:subscriptions.map(s=>({
      id:s.id,event:s.event,targetUrl:s.targetUrl,status:s.status,createdAt:s.createdAt,
      consecutiveFailures:s.consecutiveFailures||0
    }))});
  }

  // 5. REST Hook Subscribe
  if (method === 'POST' && pathname === '/api/v1/zapier/hooks/subscribe') {
    const body=await readBody(req),targetUrl=(body.target_url||body.targetUrl||'').trim(),event=(body.event||'').trim();
    if(!targetUrl||!event)return sendJson(res,400,{error:'target_url and event are required'});
    if(!isSafeWebhookUrl(targetUrl))return sendJson(res,400,{error:'A valid public HTTPS endpoint is required',code:'INVALID_WEBHOOK_URL'});
    try{await assertPublicWebhookTarget(targetUrl);}catch(error){return sendJson(res,400,{error:'Webhook destination failed public-address validation',code:error.code||'INVALID_WEBHOOK_URL'});}
    if(zapierRepository){
      if(typeof secretResolver?.store!=='function')return sendJson(res,503,{error:'Encrypted secret storage unavailable',code:'SECRET_RESOLVER_UNAVAILABLE'});
      const id=randomUUID(),secret=randomBytes(32).toString('base64url'),secretRef=`vault:${agency.id}/${activeLocation.id}/zapier-hook-${id}`;
      try{
        await secretResolver.store(secretRef,secret);
        const created=await zapierRepository.createSubscription({tenantId:agency.id,locationId:activeLocation.id,event,targetUrl,signingSecretRef:secretRef});
        return sendJson(res,201,{id:created.id,target_url:created.target_url,event:created.event,status:created.status,createdAt:created.created_at});
      }catch(error){await secretResolver.delete(secretRef).catch(()=>{});return sendJson(res,400,{error:'Could not create webhook subscription',code:error.code||'ZAPIER_SUBSCRIPTION_CREATE_FAILED'});}
    }
    state.zapierHookSubscriptions=state.zapierHookSubscriptions||[];
    const sub={id:`zhk_${randomBytes(8).toString('hex')}`,agencyId:agency.id,locationId:activeLocation.id,event,targetUrl,
      signingSecret:randomBytes(32).toString('base64url'),status:'active',consecutiveFailures:0,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    state.zapierHookSubscriptions.push(sub);await saveState();
    return sendJson(res,201,{id:sub.id,target_url:sub.targetUrl,event:sub.event,status:sub.status,createdAt:sub.createdAt});
  }

  // 6. REST Hook Unsubscribe
  if(method==='DELETE'&&pathname.startsWith('/api/v1/zapier/hooks/unsubscribe')){
    let subId=pathname.replace('/api/v1/zapier/hooks/unsubscribe','').replace(/^\//,'').trim();
    if(!subId){const body=await readBody(req).catch(()=>({}));subId=body.subscription_id||body.subscriptionId||body.id;}
    if(zapierRepository){
      const cancelled=await zapierRepository.cancelSubscription({tenantId:agency.id,locationId:activeLocation.id,subscriptionId:subId});
      if(!cancelled)return sendJson(res,404,{error:'Webhook subscription not found'});
      return sendJson(res,200,{success:true,id:cancelled.id,status:cancelled.status,unsubscribed:true});
    }
    state.zapierHookSubscriptions=state.zapierHookSubscriptions||[];
    const sub=state.zapierHookSubscriptions.find(s=>s.id===subId&&s.agencyId===agency.id&&s.locationId===activeLocation.id);
    if(!sub)return sendJson(res,404,{error:'Webhook subscription not found'});
    sub.status='cancelled';sub.updatedAt=new Date().toISOString();await saveState();
    return sendJson(res,200,{success:true,id:sub.id,status:'cancelled',unsubscribed:true});
  }

  // 7. REST Hook Instant Test Ping (/api/v1/zapier/hooks/test)
  if (method === 'POST' && pathname === '/api/v1/zapier/hooks/test') {
    const body = await readBody(req);
    const targetUrl = (body.targetUrl || body.target_url || '').trim();
    const event = (body.event || 'contact.created').trim();

    if (!targetUrl || !isSafeWebhookUrl(targetUrl)) {
      return sendJson(res, 400, { error: 'A valid public HTTPS targetUrl is required for webhook testing' });
    }

    const samples = getZapierSamples(event, state.records || {});
    const samplePayload = samples[0] || { test: true, timestamp: new Date().toISOString() };
    const deliveryId = `test_deliv_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const testSecret = `sec_test_${randomBytes(16).toString('hex')}`;
    const payload = { event, deliveryId, timestamp, data: samplePayload };
    const signature = createHmac('sha256', testSecret)
      .update(`${timestamp}.${JSON.stringify(payload)}`)
      .digest('hex');

    let httpStatus = 0;
    let delivered = false;
    try {
      const response = await sendWebhook(targetUrl, {
        headers: {
          'Content-Type': 'application/json',
          'X-Operza-Signature': `t=${timestamp},v1=${signature}`,
          'X-Operza-Event': event,
          'X-Operza-Delivery-Id': deliveryId
        },
        body: JSON.stringify(payload),
        timeoutMs: 10_000
      });
      httpStatus = response.status;
      delivered = Boolean(response.ok);
    } catch {
      httpStatus = 502;
    }

    state.zapierHookDeliveries = state.zapierHookDeliveries || [];
    state.zapierHookDeliveries.unshift({
      id: deliveryId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      event,
      targetUrl,
      httpStatus,
      delivered,
      deliveredAt: new Date().toISOString()
    });
    if (state.zapierHookDeliveries.length > 200) state.zapierHookDeliveries.length = 200;
    await saveState();

    if (!delivered) {
      return sendJson(res, 502, {
        success: false,
        code: 'WEBHOOK_TEST_FAILED',
        deliveryId,
        httpStatus,
        signatureHeader: `t=${timestamp},v1=${signature}`,
        error: `Target webhook endpoint returned HTTP ${httpStatus || 'network failure'}`
      });
    }
    return sendJson(res, 200, {
      success: true,
      delivered: true,
      deliveryId,
      targetUrl,
      event,
      httpStatus,
      sampleSent: samplePayload,
      signatureHeader: `t=${timestamp},v1=${signature}`
    });
  }

  // 8. Delivery Logs
  if (method === 'GET' && pathname === '/api/v1/zapier/deliveries') {
    if (zapierRepository) {
      const deliveries=await zapierRepository.listDeliveries({tenantId:agency.id,locationId:activeLocation.id,limit:50});
      return sendJson(res,200,{success:true,deliveries});
    }
    state.zapierHookDeliveries=state.zapierHookDeliveries||[];
    const deliveries=state.zapierHookDeliveries.filter(d=>d.agencyId===agency.id&&d.locationId===activeLocation.id).slice(0,50);
    return sendJson(res,200,{success:true,deliveries});
  }

  // 9. Samples Catalog (/api/v1/zapier/samples/:event)
  if (method === 'GET' && pathname.startsWith('/api/v1/zapier/samples/')) {
    const event = pathname.replace('/api/v1/zapier/samples/', '').trim();
    const samples = getZapierSamples(event, state.records || {});
    return sendJson(res, 200, samples);
  }

  // 10. Polling Trigger Fallback (/api/v1/zapier/polls/:event)
  if (method === 'GET' && pathname.startsWith('/api/v1/zapier/polls/')) {
    const event = pathname.replace('/api/v1/zapier/polls/', '').trim();
    state.records = state.records || {};

    if (event === 'contact.created' || event === 'contact.updated') {
      const contacts = (state.records.contacts || [])
        .filter(c => c.agencyId === agency.id)
        .slice(0, 25);
      return sendJson(res, 200, contacts.length > 0 ? contacts : getZapierSamples(event));
    }

    if (event === 'opportunity.created' || event === 'opportunity.stage_changed') {
      const opps = (state.records.opportunities || [])
        .filter(o => o.agencyId === agency.id)
        .slice(0, 25);
      return sendJson(res, 200, opps.length > 0 ? opps : getZapierSamples(event));
    }

    if (event === 'appointment.booked' || event === 'appointment.cancelled') {
      const apts = (state.records.appointments || [])
        .filter(a => a.agencyId === agency.id)
        .slice(0, 25);
      return sendJson(res, 200, apts.length > 0 ? apts : getZapierSamples(event));
    }

    if (event === 'task.created') {
      const tasks = (state.records.tasks || [])
        .filter(t => t.agencyId === agency.id)
        .slice(0, 25);
      return sendJson(res, 200, tasks.length > 0 ? tasks : getZapierSamples(event));
    }

    if (event === 'payment.received') {
      const payments = (state.records.payments || [])
        .filter(p => p.agencyId === agency.id)
        .slice(0, 25);
      return sendJson(res, 200, payments.length > 0 ? payments : getZapierSamples(event));
    }

    return sendJson(res, 200, getZapierSamples(event, state.records));
  }

  // 11. Inbound Searches (/api/v1/zapier/searches/:searchKey)
  if (method === 'POST' && pathname.startsWith('/api/v1/zapier/searches/')) {
    const searchKey = pathname.replace('/api/v1/zapier/searches/', '').trim();
    const body = await readBody(req);
    const query = body.query || body;

    switch (searchKey) {
      case 'find_contact': {
        state.records.contacts = state.records.contacts || [];
        const email = (query.email || '').toLowerCase().trim();
        const phone = (query.phone || '').trim();
        const id = query.id || query.contactId;
        const name = (query.name || '').toLowerCase().trim();

        const contact = state.records.contacts.find(c =>
          c.agencyId === agency.id && (
            (id && c.id === id) ||
            (email && (c.email || '').toLowerCase() === email) ||
            (phone && c.phone === phone) ||
            (name && `${c.firstName} ${c.lastName}`.toLowerCase().includes(name))
          )
        );

        return sendJson(res, 200, {
          found: Boolean(contact),
          contact: contact || null,
          results: contact ? [contact] : []
        });
      }

      case 'find_opportunity': {
        state.records.opportunities = state.records.opportunities || [];
        const id = query.id || query.opportunityId;
        const contactEmail = (query.contactEmail || '').toLowerCase().trim();
        const name = (query.name || '').toLowerCase().trim();

        const opp = state.records.opportunities.find(o =>
          o.agencyId === agency.id && (
            (id && o.id === id) ||
            (contactEmail && (o.contactEmail || '').toLowerCase() === contactEmail) ||
            (name && (o.name || '').toLowerCase().includes(name))
          )
        );

        return sendJson(res, 200, {
          found: Boolean(opp),
          opportunity: opp || null,
          results: opp ? [opp] : []
        });
      }

      case 'find_appointment': {
        state.records.appointments = state.records.appointments || [];
        const id = query.id || query.appointmentId;
        const contactName = (query.contactName || '').toLowerCase().trim();
        const date = (query.date || '').trim();

        const apt = state.records.appointments.find(a =>
          a.agencyId === agency.id && (
            (id && a.id === id) ||
            (contactName && (a.contactName || '').toLowerCase().includes(contactName)) ||
            (date && a.startsAt && a.startsAt.startsWith(date))
          )
        );

        return sendJson(res, 200, {
          found: Boolean(apt),
          appointment: apt || null,
          results: apt ? [apt] : []
        });
      }

      case 'find_task': {
        state.records.tasks = state.records.tasks || [];
        const id = query.id || query.taskId;
        const title = (query.title || '').toLowerCase().trim();
        const assignedTo = (query.assignedTo || '').toLowerCase().trim();

        const task = state.records.tasks.find(t =>
          t.agencyId === agency.id && (
            (id && t.id === id) ||
            (title && (t.title || '').toLowerCase().includes(title)) ||
            (assignedTo && (t.assignedTo || '').toLowerCase().includes(assignedTo))
          )
        );

        return sendJson(res, 200, {
          found: Boolean(task),
          task: task || null,
          results: task ? [task] : []
        });
      }

      default:
        return sendJson(res, 404, { error: `Unsupported Zapier search: ${searchKey}` });
    }
  }

  // 12. Inbound Actions (/api/v1/zapier/actions/:actionKey)
  if (method === 'POST' && pathname.startsWith('/api/v1/zapier/actions/')) {
    const actionKey = pathname.replace('/api/v1/zapier/actions/', '').trim();
    const body = await readBody(req);
    const data = body.data || body;

    switch (actionKey) {
      case 'create_contact': {
        const email = (data.email || '').trim().toLowerCase();
        const phone = (data.phone || '').trim();
        const firstName = data.firstName || data.first_name || 'Inbound';
        const lastName = data.lastName || data.last_name || 'Contact';

        state.records.contacts = state.records.contacts || [];
        let contact = null;
        if (email) {
          contact = state.records.contacts.find(c => c.agencyId === agency.id && (c.email || '').toLowerCase() === email);
        }
        if (!contact && phone) {
          contact = state.records.contacts.find(c => c.agencyId === agency.id && c.phone === phone);
        }

        const isNew = !contact;
        if (isNew) {
          contact = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            firstName,
            lastName,
            email,
            phone,
            company: data.company || '',
            tags: Array.isArray(data.tags) ? data.tags : ['zapier-inbound'],
            status: data.status || 'lead',
            createdAt: new Date().toISOString()
          };
          state.records.contacts.push(contact);
        } else {
          if (data.company) contact.company = data.company;
          if (Array.isArray(data.tags)) {
            contact.tags = Array.from(new Set([...(contact.tags || []), ...data.tags]));
          }
          if (data.status) contact.status = data.status;
          contact.updatedAt = new Date().toISOString();
        }

        await saveState();
        broadcast('crm.contact.updated', { id: contact.id, isNew });
        return sendJson(res, isNew ? 201 : 200, { success: true, contactId: contact.id, isNew, contact });
      }

      case 'update_contact': {
        state.records.contacts = state.records.contacts || [];
        const contactId = data.id || data.contactId;
        const email = (data.email || '').toLowerCase().trim();

        const contact = state.records.contacts.find(c =>
          c.agencyId === agency.id && (
            (contactId && c.id === contactId) ||
            (email && (c.email || '').toLowerCase() === email)
          )
        );

        if (!contact) return sendJson(res, 404, { error: 'Contact not found for update' });

        if (data.firstName || data.first_name) contact.firstName = data.firstName || data.first_name;
        if (data.lastName || data.last_name) contact.lastName = data.lastName || data.last_name;
        if (data.phone) contact.phone = data.phone;
        if (data.company) contact.company = data.company;
        if (data.status) contact.status = data.status;
        if (Array.isArray(data.tags)) {
          contact.tags = Array.from(new Set([...(contact.tags || []), ...data.tags]));
        }
        if (data.customFields && typeof data.customFields === 'object') {
          contact.customFields = { ...(contact.customFields || {}), ...data.customFields };
        }
        contact.updatedAt = new Date().toISOString();

        await saveState();
        broadcast('crm.contact.updated', { id: contact.id, isNew: false, contact });
        return sendJson(res, 200, { success: true, contactId: contact.id, contact });
      }

      case 'create_opportunity': {
        state.records.opportunities = state.records.opportunities || [];
        const newOpp = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          name: data.name || data.title || 'Inbound Opportunity via Zapier',
          value: Number(data.value) || 1000,
          stage: data.stage || 'Discovery',
          pipeline: data.pipeline || 'Sales Pipeline',
          status: data.status || 'open',
          contactEmail: data.contactEmail || '',
          contactName: data.contactName || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.opportunities.push(newOpp);
        await saveState();
        broadcast('crm.opportunity.created', newOpp);
        return sendJson(res, 201, { success: true, opportunityId: newOpp.id, opportunity: newOpp });
      }

      case 'update_opportunity': {
        state.records.opportunities = state.records.opportunities || [];
        const oppId = data.opportunityId || data.id;
        let opp = state.records.opportunities.find(o => o.id === oppId && o.agencyId === agency.id);

        if (!opp && data.contactEmail) {
          opp = state.records.opportunities.find(o => o.agencyId === agency.id && (o.contactEmail || '').toLowerCase() === data.contactEmail.toLowerCase());
        }

        if (!opp) {
          opp = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            name: data.name || 'Zapier Opportunity',
            value: Number(data.value) || 1000,
            stage: data.stage || 'Discovery',
            status: data.status || 'open',
            contactEmail: data.contactEmail || '',
            createdAt: new Date().toISOString()
          };
          state.records.opportunities.push(opp);
        } else {
          if (data.stage) opp.stage = data.stage;
          if (data.value !== undefined) opp.value = Number(data.value);
          if (data.status) opp.status = data.status;
          opp.updatedAt = new Date().toISOString();
        }

        await saveState();
        broadcast('crm.opportunity.updated', { id: opp.id, stage: opp.stage });
        return sendJson(res, 200, { success: true, opportunityId: opp.id, stage: opp.stage, value: opp.value, status: opp.status, opportunity: opp });
      }

      case 'create_appointment': {
        state.records.appointments = state.records.appointments || [];
        const startsAt = data.startsAt || data.date || new Date(Date.now() + 86400000).toISOString();
        const durationMin = Number(data.durationMin) || 30;
        const endsAt = data.endsAt || new Date(new Date(startsAt).getTime() + durationMin * 60000).toISOString();

        const apt = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          calendarId: data.calendarId || 'default-calendar',
          calendarName: data.calendarName || 'Strategy Consultation',
          title: data.title || `Consultation with ${data.contactName || 'Lead'}`,
          contactName: data.contactName || 'Inbound Lead',
          contactEmail: (data.contactEmail || '').toLowerCase().trim(),
          contactPhone: data.contactPhone || '',
          startsAt,
          endsAt,
          status: 'confirmed',
          notes: data.notes || 'Scheduled via Zapier Action',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.appointments.push(apt);
        await saveState();
        broadcast('crm.appointment.created', apt);
        return sendJson(res, 201, { success: true, appointmentId: apt.id, appointment: apt });
      }

      case 'create_task': {
        state.records.tasks = state.records.tasks || [];
        const task = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          title: data.title || 'Task from Zapier',
          dueDate: data.dueDate || new Date(Date.now() + 86400000).toISOString(),
          priority: data.priority || 'medium',
          assignedTo: data.assignedTo || actor.user.name || 'Team Operator',
          contactId: data.contactId || null,
          status: 'pending',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.tasks.push(task);
        await saveState();
        broadcast('crm.task.created', task);
        return sendJson(res, 201, { success: true, taskId: task.id, task });
      }

      case 'add_tag': {
        const tag = (data.tag || '').trim();
        if (!tag) return sendJson(res, 400, { error: 'tag is required' });

        state.records.contacts = state.records.contacts || [];
        const contactId = data.contactId;
        const email = (data.email || '').toLowerCase();

        const contact = state.records.contacts.find(c =>
          c.agencyId === agency.id &&
          ((contactId && c.id === contactId) || (email && (c.email || '').toLowerCase() === email))
        );

        if (!contact) return sendJson(res, 404, { error: 'Contact not found for tagging' });

        contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
        contact.updatedAt = new Date().toISOString();
        await saveState();

        broadcast('crm.contact.updated', { id: contact.id, tags: contact.tags });
        return sendJson(res, 200, { success: true, contactId: contact.id, tags: contact.tags, added: tag, contact });
      }

      case 'remove_tag': {
        const tag = (data.tag || '').trim();
        if (!tag) return sendJson(res, 400, { error: 'tag is required' });

        state.records.contacts = state.records.contacts || [];
        const contactId = data.contactId;
        const email = (data.email || '').toLowerCase();

        const contact = state.records.contacts.find(c =>
          c.agencyId === agency.id &&
          ((contactId && c.id === contactId) || (email && (c.email || '').toLowerCase() === email))
        );

        if (!contact) return sendJson(res, 404, { error: 'Contact not found for tag removal' });

        contact.tags = (contact.tags || []).filter(t => t !== tag);
        contact.updatedAt = new Date().toISOString();
        await saveState();

        broadcast('crm.contact.updated', { id: contact.id, tags: contact.tags });
        return sendJson(res, 200, { success: true, contactId: contact.id, tags: contact.tags, removed: tag, contact });
      }

      case 'create_note': {
        const noteText = data.note || data.text || data.content || '';
        if (!noteText) return sendJson(res, 400, { error: 'note content is required' });

        state.records.contacts = state.records.contacts || [];
        const contactId = data.contactId;
        const email = (data.email || '').toLowerCase();

        const contact = state.records.contacts.find(c =>
          c.agencyId === agency.id &&
          ((contactId && c.id === contactId) || (email && (c.email || '').toLowerCase() === email))
        );

        if (!contact) return sendJson(res, 404, { error: 'Contact not found for adding note' });

        contact.notes = contact.notes || [];
        const newNote = {
          id: randomUUID(),
          text: noteText,
          author: data.author || 'Zapier Integration',
          createdAt: new Date().toISOString()
        };
        contact.notes.push(newNote);
        contact.updatedAt = new Date().toISOString();
        await saveState();

        return sendJson(res, 201, { success: true, contactId: contact.id, noteId: newNote.id, note: newNote });
      }

      case 'trigger_workflow': {
        const wfId = data.workflowId;
        const wfName = (data.workflowName || data.name || '').toLowerCase();
        state.records.workflows = state.records.workflows || [];

        const flow = state.records.workflows.find(w =>
          w.agencyId === agency.id && w.locationId === activeLocation.id &&
          ((wfId && w.id === wfId) || (wfName && (w.name || '').toLowerCase() === wfName))
        );

        if (!flow) return sendJson(res, 404, { error: 'Target workflow not found in tenant' });

        const mode = data.mode === 'live' ? 'live' : 'dry_run';
        const execution = await executeWorkflowInstance({
          flow,
          agencyId: agency.id,
          locationId: activeLocation.id,
          triggerType: 'zapier_webhook',
          mode,
          triggerContext: {
            payload: data.triggerContext || data.payload || {},
            triggeredBy: 'Zapier REST Action',
            actorId: actor.user.id
          }
        });

        return sendJson(res, 201, {
          success: true,
          executionId: execution.id,
          workflowId: flow.id,
          status: execution.status,
          mode,
          queuedAt: new Date().toISOString()
        });
      }

      case 'send_communication': {
        // This action must not claim success until a verified provider adapter,
        // consent re-check and durable dispatch receipt are wired into this route.
        return sendJson(res, 501, {
          success: false,
          status: 'not_configured',
          code: 'PROVIDER_DISPATCH_NOT_IMPLEMENTED',
          message: 'Communication dispatch is not enabled for this Zapier action yet.'
        });
      }

      case 'send_notification': {
        const title = data.title || 'Zapier Notification';
        const message = data.message || data.text || '';
        const channel = data.channel || 'in_app';
        state.notifications = state.notifications || [];
        const notif = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          title,
          message,
          channel,
          read: false,
          createdAt: new Date().toISOString()
        };
        state.notifications.unshift(notif);
        if (state.notifications.length > 200) state.notifications.length = 200;
        await saveState();
        broadcast('crm.notification.created', notif);
        return sendJson(res, 201, { success: true, notificationId: notif.id, notification: notif });
      }

      default:
        return sendJson(res, 404, { error: `Unsupported Zapier action: ${actionKey}` });
    }
  }

  sendJson(res, 404, { error: 'Zapier endpoint not found' });
  return true;
}
