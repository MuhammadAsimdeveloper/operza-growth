/**
 * ============================================================================
 * Operza Analytics & Business Intelligence 2.0 Router (TenantTx + FORCE RLS)
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createAnalytics2Repository } from '../../../packages/db/lib/analytics-2-repository.mjs';
import {
  formatSafeCsv,
  METRIC_CATALOG_V2,
  redactExportRows
} from '../../../packages/platform-core/src/analytics-2-0.mjs';
import { aggregateCanonicalRevenueByCurrency } from '../../../packages/platform-core/src/cross-platform-events.mjs';

const analyticsRepo = createAnalytics2Repository();

export async function handleAnalytics2Routes(req, res, ctx) {
  const { method, pathname, url, actor, agency, activeLocation, pgPool, readBody, sendJson } = ctx;

  if (!pathname.startsWith('/api/reports/v2/')) {
    return false;
  }

  const subPath = pathname.replace(/^\/api\/reports\/v2/, '');
  const userId = actor?.user?.id || actor?.id || 'system';
  const tenantCtx = { agencyId: agency?.id, locationId: activeLocation?.id, actorId: userId };

  if (method === 'GET' && subPath === '/catalog') {
    sendJson(res, 200, { count: METRIC_CATALOG_V2.length, metrics: METRIC_CATALOG_V2 });
    return true;
  }

  if (!pgPool) {
    const state = ctx.state || {};
    const contacts = (state.contacts || []).filter(c => !c.agencyId || c.agencyId === agency?.id);
    const opps = (state.opportunities || []).filter(o => !o.agencyId || o.agencyId === agency?.id);
    const invoices = (state.invoices || []).filter(i => !i.agencyId || i.agencyId === agency?.id);
    const workflows = (state.workflowExecutions || []).filter(w => !w.agencyId || w.agencyId === agency?.id);
    const convs = (state.conversations || []).filter(c => !c.agencyId || c.agencyId === agency?.id);
    const revenueByCurrency = aggregateCanonicalRevenueByCurrency({ invoices, refunds: state.refunds || [] });

    if (method === 'GET' && subPath === '/overview') {
      sendJson(res, 200, {
        source: 'local_dev_in_memory',
        authoritative: false,
        warning: 'Computed from local in-memory state because PostgreSQL is not configured in this environment.',
        freshnessAt: new Date().toISOString(),
        totals: {
          contacts: contacts.length,
          opportunities: opps.length,
          wonOpportunities: opps.filter(o => o.stage === 'won' || o.status === 'won').length,
          conversations: convs.length,
          workflowExecutions: workflows.length
        },
        revenueByCurrency
      });
      return true;
    }
    if (method === 'GET' && subPath === '/dashboards') {
      sendJson(res, 200, { dashboards: [] });
      return true;
    }
    if (method === 'GET' && subPath === '/saved-reports') {
      sendJson(res, 200, { reports: [] });
      return true;
    }
    sendJson(res, 503, { error: 'PostgreSQL required for custom Analytics 2.0 mutations', code: 'PG_REQUIRED' });
    return true;
  }

  if (method === 'GET' && subPath === '/overview') {
    const from = url?.searchParams?.get('from') || null;
    const to = url?.searchParams?.get('to') || null;
    const overview = await runInTenantTx(pgPool, tenantCtx, tx => analyticsRepo.getExecutiveOverview(tx, { from, to }));
    sendJson(res, 200, overview);
    return true;
  }

  if (method === 'POST' && subPath === '/query') {
    const body = await readBody(req);
    try {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        analyticsRepo.runCustomReport(tx, {
          ...(body || {}),
          actorPermissions: actor?.scopes || ['*']
        })
      );
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, err.code === 'FORBIDDEN_REPORT_SOURCE' ? 403 : 400, {
        error: err.message,
        code: err.code || 'REPORT_QUERY_ERROR'
      });
    }
    return true;
  }

  if (subPath === '/dashboards') {
    if (method === 'GET') {
      const dashboards = await runInTenantTx(pgPool, tenantCtx, tx => analyticsRepo.listSavedDashboards(tx, { userId }));
      sendJson(res, 200, { dashboards });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      const dashboard = await runInTenantTx(pgPool, tenantCtx, tx =>
        analyticsRepo.createSavedDashboard(tx, { ...(body || {}), ownerUserId: userId })
      );
      sendJson(res, 201, { dashboard });
      return true;
    }
  }

  if (subPath === '/saved-reports') {
    if (method === 'GET') {
      const reports = await runInTenantTx(pgPool, tenantCtx, tx => analyticsRepo.listSavedReports(tx, { userId }));
      sendJson(res, 200, { reports });
      return true;
    }
    if (method === 'POST') {
      const body = await readBody(req);
      try {
        const report = await runInTenantTx(pgPool, tenantCtx, tx =>
          analyticsRepo.createSavedReport(tx, { ...(body || {}), ownerUserId: userId })
        );
        sendJson(res, 201, { report });
      } catch (err) {
        sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_REPORT' });
      }
      return true;
    }
  }

  if (method === 'POST' && subPath === '/schedules') {
    const body = await readBody(req);
    const schedule = await runInTenantTx(pgPool, tenantCtx, tx => analyticsRepo.createScheduledReport(tx, body || {}));
    sendJson(res, 201, { schedule });
    return true;
  }

  if (method === 'POST' && subPath === '/alerts') {
    const body = await readBody(req);
    const alert = await runInTenantTx(pgPool, tenantCtx, tx => analyticsRepo.createThresholdAlert(tx, body || {}));
    sendJson(res, 201, { alert });
    return true;
  }

  if (method === 'POST' && subPath === '/export') {
    const body = await readBody(req);
    try {
      const result = await runInTenantTx(pgPool, tenantCtx, tx =>
        analyticsRepo.runCustomReport(tx, { ...(body || {}), actorPermissions: actor?.scopes || ['*'] })
      );
      const redacted = redactExportRows(result.rows, { allowPii: false });
      const format = body?.format === 'csv' ? 'csv' : 'json';
      sendJson(res, 200, {
        format,
        rowCount: redacted.length,
        data: format === 'csv' ? formatSafeCsv(redacted) : redacted
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'EXPORT_ERROR' });
    }
    return true;
  }

  return false;
}
