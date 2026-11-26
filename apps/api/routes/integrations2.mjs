/**
 * ============================================================================
 * Operza Integrations Hub 2.0 Router — TenantTx & Connector SDK 2.0 Boundary
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createIntegrations2Repository } from '../../../packages/db/lib/integrations-2-repository.mjs';
import { createConnectorSdkV2 } from '../../../packages/platform-core/src/connector-sdk-v2.mjs';
import { verifyWebhookSignature } from '../../../packages/platform-core/src/webhook-platform-v2.mjs';

const integrationsRepo = createIntegrations2Repository();
const connectorSdk = createConnectorSdkV2();

function checkScope(actor, requiredScope) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  return scopes.includes('*') || scopes.includes('all') || scopes.includes(requiredScope);
}

export async function handleIntegrations2Routes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
    actor,
    agency,
    activeLocation,
    pgPool,
    readBody,
    sendJson,
    auditLog
  } = ctx;

  if (!pathname.startsWith('/api/integrations/v2/')) {
    return false;
  }

  const subPath = pathname.replace(/^\/api\/integrations\/v2/, '');
  const tenantCtx = {
    agencyId: agency?.id,
    locationId: activeLocation?.id,
    actorId: actor?.user?.id || actor?.id || 'system'
  };

  // 1. Connector Catalog
  if (method === 'GET' && subPath === '/catalog') {
    const category = url?.searchParams?.get('category') || 'all';
    const search = url?.searchParams?.get('search') || '';
    const connectors = connectorSdk.list({ category, search });
    sendJson(res, 200, { count: connectors.length, connectors });
    return true;
  }

  // 2. Workflow Node Export
  if (method === 'GET' && subPath === '/workflow-nodes') {
    const nodes = connectorSdk.exportWorkflowNodes({ grantedScopes: actor?.scopes || null });
    sendJson(res, 200, { count: nodes.length, nodes });
    return true;
  }

  // 3. Integration Observability Metrics
  if (method === 'GET' && subPath === '/metrics') {
    if (!checkScope(actor, 'integrations:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: integrations:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (pgPool) {
      const metrics = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.getIntegrationMetrics(tx));
      sendJson(res, 200, metrics);
      return true;
    }
    sendJson(res, 200, {
      connections: { total: 0, active: 0, degraded: 0 },
      webhookEvents: { total_events: 0, dead_letter_count: 0 },
      openSyncConflicts: 0
    });
    return true;
  }

  // 4. Connections CRUD & Lifecycle
  if (subPath === '/connections') {
    if (method === 'GET') {
      if (!checkScope(actor, 'integrations:read')) {
        sendJson(res, 403, { error: 'Insufficient scope: integrations:read', code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      if (!pgPool) {
        sendJson(res, 200, { connections: [] });
        return true;
      }
      const connectorId = url?.searchParams?.get('connectorId') || null;
      const connections = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.listConnections(tx, { connectorId }));
      sendJson(res, 200, { connections });
      return true;
    }
    if (method === 'POST') {
      if (!checkScope(actor, 'integrations:write')) {
        sendJson(res, 403, { error: 'Insufficient scope: integrations:write', code: 'INSUFFICIENT_SCOPES' });
        return true;
      }
      const body = await readBody(req);
      const spec = connectorSdk.get(body?.connectorId);
      if (!spec) {
        sendJson(res, 400, { error: 'Unknown connectorId', code: 'UNKNOWN_CONNECTOR' });
        return true;
      }
      if (!pgPool) {
        sendJson(res, 503, { error: 'PostgreSQL required for durable connection storage', code: 'PG_REQUIRED' });
        return true;
      }
      const conn = await runInTenantTx(pgPool, tenantCtx, tx =>
        integrationsRepo.createConnection(tx, {
          connectorId: spec.id,
          provider: spec.provider,
          accountLabel: body?.accountLabel || spec.name,
          authStrategy: spec.authStrategy,
          status: body?.vaultSecretRef ? 'active' : 'pending',
          readinessLevel: spec.readinessLevel,
          vaultSecretRef: body?.vaultSecretRef || null,
          grantedScopes: spec.requiredScopes,
          config: body?.config || {},
          createdBy: tenantCtx.actorId
        })
      );
      auditLog?.('integrations.v2.connected', actor, { id: conn.id, connectorId: spec.id });
      sendJson(res, 201, { connection: conn });
      return true;
    }
  }

  const connActionMatch = subPath.match(/^\/connections\/([^/]+)\/(test|disconnect)$/);
  if (method === 'POST' && connActionMatch) {
    if (!checkScope(actor, 'integrations:write')) {
      sendJson(res, 403, { error: 'Insufficient scope: integrations:write', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    const [, connectionId, action] = connActionMatch;
    if (!pgPool) {
      sendJson(res, 503, { error: 'PostgreSQL required', code: 'PG_REQUIRED' });
      return true;
    }
    const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
      const existing = await integrationsRepo.getConnection(tx, connectionId);
      if (!existing) return null;
      if (action === 'disconnect') {
        return integrationsRepo.updateConnectionStatus(tx, connectionId, { status: 'disconnected' });
      }
      const nextStatus = existing.hasSecretRef ? 'active' : 'pending';
      return integrationsRepo.updateConnectionStatus(tx, connectionId, {
        status: nextStatus,
        lastTestedAt: new Date().toISOString()
      });
    });
    if (!updated) {
      sendJson(res, 404, { error: 'Connection not found' });
      return true;
    }
    sendJson(res, 200, { connection: updated });
    return true;
  }

  // 5. Webhook Events & Signed Ingest
  if (method === 'GET' && subPath === '/webhooks/events') {
    if (!checkScope(actor, 'integrations:read')) {
      sendJson(res, 403, { error: 'Insufficient scope: integrations:read', code: 'INSUFFICIENT_SCOPES' });
      return true;
    }
    if (!pgPool) {
      sendJson(res, 200, { events: [] });
      return true;
    }
    const events = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.listWebhookEvents(tx));
    sendJson(res, 200, { events });
    return true;
  }

  const ingestMatch = subPath.match(/^\/webhooks\/ingest\/([^/]+)$/);
  if (method === 'POST' && ingestMatch) {
    const provider = ingestMatch[1];
    const body = await readBody(req);
    const sigHeader = req.headers['x-operza-signature'];
    const webhookSecret = process.env.OPERZA_WEBHOOK_INGEST_SECRET || '';
    if (webhookSecret) {
      const check = verifyWebhookSignature({
        rawBody: JSON.stringify(body || {}),
        signatureHeader: sigHeader,
        secret: webhookSecret
      });
      if (!check.valid) {
        sendJson(res, 401, { error: 'Invalid webhook signature', code: check.code });
        return true;
      }
    }
    if (!pgPool) {
      sendJson(res, 202, { accepted: true, deduplicated: false });
      return true;
    }
    const resEv = await runInTenantTx(pgPool, tenantCtx, tx =>
      integrationsRepo.recordWebhookEvent(tx, {
        provider,
        providerEventId: body?.providerEventId || body?.id,
        eventType: body?.eventType || 'webhook.event',
        payload: body?.payload || body || {}
      })
    );
    sendJson(res, 202, resEv);
    return true;
  }

  // 6. Sync Jobs & Conflicts
  if (subPath === '/sync/jobs') {
    if (!pgPool) {
      sendJson(res, 200, { jobs: [] });
      return true;
    }
    if (method === 'GET') {
      const jobs = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.listSyncJobs(tx));
      sendJson(res, 200, { jobs });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const job = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.createSyncJob(tx, body || {}));
      sendJson(res, 201, { job });
      return true;
    }
  }

  if (method === 'GET' && subPath === '/sync/conflicts') {
    if (!pgPool) {
      sendJson(res, 200, { conflicts: [] });
      return true;
    }
    const conflicts = await runInTenantTx(pgPool, tenantCtx, tx => integrationsRepo.listSyncConflicts(tx));
    sendJson(res, 200, { conflicts });
    return true;
  }

  return false;
}
