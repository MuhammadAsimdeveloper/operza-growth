/**
 * ============================================================================
 * Operza Cross-Platform Canonical Entities, Event Contracts & Health 2.0
 * ============================================================================
 */

import crypto from 'node:crypto';
import { generateDeterministicIdempotencyKey } from './outbox-producer.mjs';
import { redactSensitivePayload } from '../../workflow-engine/src/graph-validator-v2.mjs';

export const CANONICAL_ENTITY_OWNERSHIP = Object.freeze({
  contact: { domain: 'CRM', table: 'location_records (collection=contacts)', tenantKey: '(agency_id, location_id, id)' },
  company: { domain: 'CRM', table: 'crm_companies / location_records', tenantKey: '(agency_id, location_id, id)' },
  opportunity: { domain: 'CRM', table: 'location_records (collection=opportunities)', tenantKey: '(agency_id, location_id, id)' },
  conversation: { domain: 'Conversations / Support', table: 'conversations', tenantKey: '(agency_id, location_id, id)' },
  support_ticket: { domain: 'Unified Inbox / Support', table: 'support_tickets', tenantKey: '(agency_id, location_id, id)' },
  campaign: { domain: 'Engagement', table: 'engagement_campaigns', tenantKey: '(agency_id, location_id, id)' },
  workflow: { domain: 'Workflow Engine', table: 'workflow_definitions + workflow_versions', tenantKey: '(agency_id, location_id, id)' },
  workflow_execution: { domain: 'Workflow Engine', table: 'workflow_executions', tenantKey: '(agency_id, location_id, id)' },
  integration_connection: { domain: 'Integrations Hub', table: 'integrations_connections', tenantKey: '(agency_id, location_id, id)' },
  ai_agent: { domain: 'AI Platform', table: 'ai_agents', tenantKey: '(agency_id, location_id, id)' },
  order: { domain: 'Commerce', table: 'commerce_orders', tenantKey: '(agency_id, location_id, id)' },
  invoice: { domain: 'Commerce', table: 'location_records / commerce_invoices', tenantKey: '(agency_id, location_id, id)' },
  payment_ledger: { domain: 'Commerce & Ledger', table: 'commerce_ledger_entries', tenantKey: '(agency_id, location_id, id)' },
  site_page: { domain: 'Sites', table: 'sites_pages', tenantKey: '(agency_id, location_id, id)' },
  customer_session: { domain: 'Customer Portal', table: 'customer_portal_sessions', tenantKey: '(agency_id, location_id, id)' },
  marketplace_install: { domain: 'Marketplace', table: 'marketplace_installations', tenantKey: '(agency_id, location_id, id)' },
  analytics_event: { domain: 'Analytics', table: 'analytics_events', tenantKey: '(agency_id, location_id, id)' }
});

export const CANONICAL_EVENT_CONTRACTS = Object.freeze({
  'crm.contact.created': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'crm.contact.updated': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'crm.opportunity.created': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'crm.opportunity.stage_changed': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'crm.opportunity.won': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'crm.opportunity.lost': { schemaVersion: '2.0', producer: 'crm', retryable: true },
  'support.conversation.created': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'support.inbound_message': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'support.conversation.assigned': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'support.ticket.created': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'support.ticket.resolved': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'support.sla.breached': { schemaVersion: '2.0', producer: 'support', retryable: true },
  'engagement.campaign.created': { schemaVersion: '2.0', producer: 'engagement', retryable: true },
  'engagement.campaign.scheduled': { schemaVersion: '2.0', producer: 'engagement', retryable: true },
  'engagement.suppression.changed': { schemaVersion: '2.0', producer: 'engagement', retryable: true },
  'engagement.campaign.completed': { schemaVersion: '2.0', producer: 'engagement', retryable: true },
  'commerce.order.created': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'commerce.invoice.issued': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'commerce.payment.recorded': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'commerce.payment.failed': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'commerce.refund.requested': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'commerce.refund.completed': { schemaVersion: '2.0', producer: 'commerce', retryable: true },
  'workflow.execution.started': { schemaVersion: '2.0', producer: 'workflows', retryable: true },
  'workflow.execution.completed': { schemaVersion: '2.0', producer: 'workflows', retryable: true },
  'workflow.execution.failed': { schemaVersion: '2.0', producer: 'workflows', retryable: true },
  'workflow.execution.dead_lettered': { schemaVersion: '2.0', producer: 'workflows', retryable: false },
  'portal.session.created': { schemaVersion: '2.0', producer: 'portal', retryable: false },
  'portal.request.submitted': { schemaVersion: '2.0', producer: 'portal', retryable: true },
  'portal.request.resolved': { schemaVersion: '2.0', producer: 'portal', retryable: true }
});

export function createCrossModuleEventEnvelope({
  eventType,
  agencyId,
  locationId,
  entityId,
  correlationId = null,
  sourceEventId = null,
  loopDepth = 0,
  payload = {}
} = {}) {
  const contract = CANONICAL_EVENT_CONTRACTS[eventType];
  if (!contract) {
    throw Object.assign(new Error(`Unknown canonical event type: ${eventType}`), {
      code: 'UNKNOWN_CANONICAL_EVENT',
      status: 400
    });
  }
  if (!agencyId || !locationId || !entityId) {
    throw Object.assign(new Error('agencyId, locationId, and entityId are required for cross-module events'), {
      code: 'TENANT_SCOPE_REQUIRED',
      status: 400
    });
  }
  if (loopDepth > 3) {
    throw Object.assign(new Error('Cross-module workflow loop depth exceeded (>3)'), {
      code: 'WORKFLOW_LOOP_PREVENTED',
      status: 409
    });
  }

  const cleanPayload = redactSensitivePayload(payload || {});
  const idempotencyKey = generateDeterministicIdempotencyKey({
    tenantId: agencyId,
    locationId,
    scope: `xmod_${eventType}`,
    uniqueEntityId: `${entityId}_${sourceEventId || 'v2'}`
  });

  return {
    eventId: `evt_${crypto.randomUUID()}`,
    eventType,
    schemaVersion: contract.schemaVersion,
    producer: contract.producer,
    retryable: contract.retryable,
    tenantScope: { agencyId, locationId },
    entityId,
    correlationId: correlationId || `corr_${crypto.randomUUID()}`,
    idempotencyKey,
    loopDepth,
    payload: cleanPayload,
    occurredAt: new Date().toISOString()
  };
}

export async function publishCrossModuleEvent({ repository, ...params }) {
  const envelope = createCrossModuleEventEnvelope(params);
  if (!repository || typeof repository.enqueue !== 'function') {
    return { enqueued: false, envelope };
  }
  const outboxRecord = await repository.enqueue({
    tenantId: envelope.tenantScope.agencyId,
    locationId: envelope.tenantScope.locationId,
    executionId: null,
    eventType: envelope.eventType,
    idempotencyKey: envelope.idempotencyKey,
    payload: envelope
  });
  return { enqueued: true, envelope, outboxRecord };
}

export function evaluateIntegrationHealth({ connections = [], webhookEvents = [], liveProvidersEnabled = false } = {}) {
  const items = (connections || []).map(conn => {
    const rawStatus = String(conn.status || 'pending').toLowerCase();
    const hasSecret = Boolean(conn.hasSecretRef || conn.vaultSecretRef || conn.vault_secret_ref);
    let healthState = 'not_configured';
    if (!liveProvidersEnabled && conn.readinessLevel === 'test_adapter') {
      healthState = 'test_adapter_only';
    } else if (rawStatus === 'disabled') {
      healthState = 'disabled';
    } else if (rawStatus === 'disconnected' || rawStatus === 'revoked') {
      healthState = 'disconnected';
    } else if (rawStatus === 'degraded') {
      healthState = 'degraded';
    } else if (rawStatus === 'error' || rawStatus === 'failed') {
      healthState = 'error';
    } else if (rawStatus === 'pending' || rawStatus === 'pending_approval') {
      healthState = hasSecret ? 'approval_pending' : 'authorization_required';
    } else if (rawStatus === 'active' || rawStatus === 'connected') {
      healthState = hasSecret ? (liveProvidersEnabled ? 'connected' : 'test_adapter_only') : 'authorization_required';
    }

    return {
      id: conn.id,
      connectorId: conn.connectorId || conn.connector_id,
      provider: conn.provider,
      accountLabel: conn.accountLabel || conn.account_label || conn.provider,
      healthState,
      hasSecretRef: hasSecret,
      lastTestedAt: conn.lastTestedAt || conn.last_tested_at || null,
      lastSyncedAt: conn.lastSyncedAt || conn.last_synced_at || null,
      lastErrorCode: conn.lastErrorCode || conn.last_error_code || null
    };
  });

  const deadLetterWebhooks = (webhookEvents || []).filter(e => e.status === 'dead_letter').length;
  return {
    liveProvidersEnabled,
    totalConnections: items.length,
    healthyCount: items.filter(i => i.healthState === 'connected' || i.healthState === 'test_adapter_only').length,
    degradedOrErrorCount: items.filter(i => ['degraded', 'error', 'disconnected'].includes(i.healthState)).length,
    deadLetterWebhooks,
    connections: items
  };
}

export function aggregateCanonicalRevenueByCurrency({ invoices = [], refunds = [] } = {}) {
  const byCurrency = new Map();
  for (const inv of invoices) {
    const status = String(inv.status || '').toLowerCase();
    if (status !== 'paid') continue;
    const cur = String(inv.currency || 'USD').toUpperCase();
    const entry = byCurrency.get(cur) || { currency: cur, grossCents: 0, refundedCents: 0, netCents: 0, paidInvoices: 0 };
    entry.grossCents += Number(inv.totalCents ?? inv.total_cents ?? Math.round((Number(inv.amount) || 0) * 100)) || 0;
    entry.paidInvoices += 1;
    byCurrency.set(cur, entry);
  }
  for (const ref of refunds) {
    if (String(ref.status || '').toLowerCase() !== 'completed') continue;
    const cur = String(ref.currency || 'USD').toUpperCase();
    const entry = byCurrency.get(cur) || { currency: cur, grossCents: 0, refundedCents: 0, netCents: 0, paidInvoices: 0 };
    entry.refundedCents += Number(ref.amountCents ?? ref.amount_cents ?? 0) || 0;
    byCurrency.set(cur, entry);
  }
  for (const entry of byCurrency.values()) {
    entry.netCents = entry.grossCents - entry.refundedCents;
  }
  return Array.from(byCurrency.values());
}
