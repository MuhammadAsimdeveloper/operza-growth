/**
 * Phase 8 — GDPR Data Export & Deletion API Routes
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createGdprRepository } from '../../../packages/db/lib/gdpr-repository.mjs';

const gdprRepo = createGdprRepository();

export function createGdprRoutes({ pgPool = null, sendJson, readBody, auditLog } = {}) {
  return async function handleGdprRoute({ method, pathname, req, res, agency, activeLocation, actor }) {
    if (!pathname.startsWith('/api/gdpr/')) return false;
    if (!pgPool) {
      return sendJson(res, 503, { error: 'PostgreSQL is required for GDPR export/deletion', code: 'PG_REQUIRED' });
    }

    const role = actor?.membership?.role || actor?.role;
    if (!['owner', 'admin'].includes(role)) {
      return sendJson(res, 403, { error: 'Admin or owner role required for GDPR operations', code: 'FORBIDDEN' });
    }

    const tenantCtx = {
      agencyId: agency?.id,
      locationId: activeLocation?.id,
      actorId: actor?.user?.id || actor?.id || 'system'
    };

    if (method === 'POST' && pathname === '/api/gdpr/export') {
      const body = await readBody(req);
      const exported = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        gdprRepo.exportSubjectData(tx, {
          subjectEmail: body?.email || null,
          contactId: body?.contactId || null,
          requestedBy: tenantCtx.actorId
        })
      );
      auditLog?.('gdpr.export_completed', actor, { exportId: exported.manifest.exportId });
      return sendJson(res, 200, exported);
    }

    if (method === 'POST' && pathname === '/api/gdpr/delete') {
      const body = await readBody(req);
      try {
        const result = await runInTenantTx(pgPool, tenantCtx, (tx) =>
          gdprRepo.deleteSubjectData(tx, {
            subjectEmail: body?.email || null,
            contactId: body?.contactId || null,
            legalHold: Boolean(body?.legalHold)
          })
        );
        auditLog?.('gdpr.deletion_completed', actor, { deletedContacts: result.deletedContacts });
        return sendJson(res, 200, result);
      } catch (err) {
        const status = err?.code === 'GDPR_LEGAL_HOLD_ACTIVE' ? 409 : 400;
        return sendJson(res, status, { error: err.message, code: err.code || 'GDPR_DELETE_FAILED' });
      }
    }

    return false;
  };
}
