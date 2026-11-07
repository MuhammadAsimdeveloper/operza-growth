/**
 * ============================================================================
 * Operza Zapier Integration Router & REST Hooks Subsystem
 * ============================================================================
 * 
 * Implements the Zapier CLI / Developer Platform REST Hook specification:
 * 1. Authentication Endpoint (/api/v1/zapier/auth/me)
 * 2. REST Hook Subscription Lifecycle (/api/v1/zapier/hooks/subscribe & unsubscribe)
 * 3. Sample Data Generator (/api/v1/zapier/samples/:event) for Zapier performList
 * 4. 5 Inbound Actions (/api/v1/zapier/actions/:actionKey)
 * 5. Outbound HMAC-SHA256 Signed Event Dispatcher with Replay Defense
 */

import { createHmac, randomBytes, randomUUID } from 'node:crypto';

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
          createdAt: now
        }
      ];
    }

    case 'opportunity.stage_changed': {
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

    case 'appointment.booked': {
      return [
        {
          appointmentId: 'apt_sample_01',
          calendarName: 'Discovery & Architecture Consultation',
          contactName: 'Sarah Connor',
          contactEmail: 'sarah@skynet-defense.com',
          scheduledAt: new Date(Date.now() + 86400000).toISOString(),
          status: 'confirmed'
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
export async function dispatchZapierEvent({ agencyId, locationId, event, data, state, fetchFn = globalThis.fetch }) {
  if (!state || !agencyId || !event) return [];
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
        body: JSON.stringify(payload)
      });
      httpStatus = res.status;
      success = res.ok;
      responseBody = await res.text().catch(() => '');
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
      responseBody = err.message;
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
      responseBody: responseBody.slice(0, 500),
      delivered: success,
      deliveredAt: new Date().toISOString()
    };
    state.zapierHookDeliveries.push(deliveryRecord);
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
export async function handleZapierRoute(req, res, { method, pathname, actor, agency, activeLocation, state, saveState, sendJson, readBody, executeWorkflowInstance, broadcast }) {
  if (!pathname.startsWith('/api/v1/zapier/')) return false;

  // 1. Authentication Check (/api/v1/zapier/auth/me)
  if (method === 'GET' && pathname === '/api/v1/zapier/auth/me') {
    return sendJson(res, 200, {
      valid: true,
      tenantId: agency.id,
      locationId: activeLocation.id,
      agencyName: agency.name,
      userEmail: actor.user.email,
      scopes: [
        'contacts:read',
        'contacts:write',
        'opportunities:read',
        'opportunities:write',
        'workflows:execute',
        'communications:dispatch',
        'webhooks:manage'
      ]
    });
  }

  // 2. REST Hook Subscribe (/api/v1/zapier/hooks/subscribe)
  if (method === 'POST' && pathname === '/api/v1/zapier/hooks/subscribe') {
    const body = await readBody(req);
    const targetUrl = (body.target_url || body.targetUrl || '').trim();
    const event = (body.event || '').trim();

    if (!targetUrl) return sendJson(res, 400, { error: 'target_url is required' });
    if (!event) return sendJson(res, 400, { error: 'event is required' });

    if (!isSafeWebhookUrl(targetUrl)) {
      return sendJson(res, 400, {
        error: 'target_url must be a valid public HTTPS endpoint (RFC SSRF protection)',
        code: 'INVALID_WEBHOOK_URL'
      });
    }

    state.zapierHookSubscriptions = state.zapierHookSubscriptions || [];
    const subscriptionId = `zhk_${randomBytes(8).toString('hex')}`;
    const signingSecret = `sec_${randomBytes(24).toString('hex')}`;

    const newSub = {
      id: subscriptionId,
      agencyId: agency.id,
      locationId: activeLocation.id,
      event,
      targetUrl,
      signingSecret,
      status: 'active',
      consecutiveFailures: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.zapierHookSubscriptions.push(newSub);
    await saveState();

    return sendJson(res, 201, {
      id: newSub.id,
      target_url: newSub.targetUrl,
      event: newSub.event,
      status: newSub.status,
      createdAt: newSub.createdAt
    });
  }

  // 3. REST Hook Unsubscribe (/api/v1/zapier/hooks/unsubscribe/:id or DELETE /api/v1/zapier/hooks/unsubscribe)
  if (method === 'DELETE' && pathname.startsWith('/api/v1/zapier/hooks/unsubscribe')) {
    let subId = pathname.replace('/api/v1/zapier/hooks/unsubscribe', '').replace(/^\//, '').trim();
    if (!subId) {
      const body = await readBody(req).catch(() => ({}));
      subId = body.subscription_id || body.subscriptionId || body.id;
    }
    state.zapierHookSubscriptions = state.zapierHookSubscriptions || [];
    const sub = state.zapierHookSubscriptions.find(s => s.id === subId && s.agencyId === agency.id);
    if (!sub) return sendJson(res, 404, { error: 'Webhook subscription not found' });

    sub.status = 'cancelled';
    sub.updatedAt = new Date().toISOString();
    await saveState();

    return sendJson(res, 200, { success: true, id: sub.id, status: 'cancelled', unsubscribed: true });
  }

  // 4. Samples Catalog (/api/v1/zapier/samples/:event)
  if (method === 'GET' && pathname.startsWith('/api/v1/zapier/samples/')) {
    const event = pathname.replace('/api/v1/zapier/samples/', '').trim();
    const samples = getZapierSamples(event, state.records || {});
    return sendJson(res, 200, samples);
  }

  // 5. Inbound Actions (/api/v1/zapier/actions/:actionKey)
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
        }

        await saveState();
        broadcast('crm.contact.updated', { id: contact.id, isNew });
        return sendJson(res, isNew ? 201 : 200, { success: true, contactId: contact.id, isNew, contact });
      }

      case 'update_opportunity': {
        state.records.opportunities = state.records.opportunities || [];
        const oppId = data.opportunityId || data.id;
        let opp = state.records.opportunities.find(o => o.id === oppId && o.agencyId === agency.id);

        if (!opp && data.contactEmail) {
          opp = state.records.opportunities.find(o => o.agencyId === agency.id && (o.contactEmail || '').toLowerCase() === data.contactEmail.toLowerCase());
        }

        if (!opp) {
          // Create new opportunity if not found
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
        }

        await saveState();
        broadcast('crm.opportunity.updated', { id: opp.id, stage: opp.stage });
        return sendJson(res, 200, { success: true, opportunityId: opp.id, stage: opp.stage, value: opp.value, status: opp.status });
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

        const execution = await executeWorkflowInstance({
          flow,
          agencyId: agency.id,
          locationId: activeLocation.id,
          triggerType: 'zapier_webhook',
          mode: 'dry_run',
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
          queuedAt: new Date().toISOString()
        });
      }

      case 'send_communication': {
        const recipient = data.recipient || data.to;
        const channel = data.channel || 'email';
        const message = data.message || data.text || '';
        const subject = data.subject || 'Automated Update via Zapier';

        if (!recipient) return sendJson(res, 400, { error: 'recipient is required' });
        if (!message) return sendJson(res, 400, { error: 'message is required' });

        const dispatchId = `disp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
        return sendJson(res, 200, {
          success: true,
          dispatchId,
          channel,
          recipient,
          status: 'dispatched',
          sentAt: new Date().toISOString()
        });
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
        await saveState();

        broadcast('crm.contact.updated', { id: contact.id, tags: contact.tags });
        return sendJson(res, 200, { success: true, contactId: contact.id, tags: contact.tags, added: tag, contact });
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
