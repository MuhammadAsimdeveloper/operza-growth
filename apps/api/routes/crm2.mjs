/**
 * Product Advancement Stage 1 — CRM 2.0 Modular API Router
 * Handles Customer 360°, duplicate detection, concurrency-safe merge,
 * CSV dry-run import preview, Smart Lists 2.0, and Custom Field definitions.
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createCrm2Repository } from '../../../packages/db/lib/crm-2-repository.mjs';
import { parseAndValidateCsvImport } from '../../../packages/platform-core/src/csv-transfer.mjs';
import { normalizeEmail, normalizePhone } from '../../../packages/platform-core/src/crm/crm-2-0.mjs';

const crm2Repo = createCrm2Repository();

export async function handleCrm2Routes(req, res, ctx) {
  const { method, pathname, url, readBody, sendJson, agency, activeLocation, actor, pgPool, auditLog } = ctx;

  const isCrm2 =
    pathname === '/api/crm/contacts/duplicates' ||
    pathname === '/api/crm/contacts/import/preview' ||
    pathname === '/api/crm/contacts/merge-safe' ||
    (pathname.startsWith('/api/crm/contacts/') && pathname.endsWith('/profile')) ||
    pathname.startsWith('/api/crm/v2/smart-lists') ||
    pathname.startsWith('/api/crm/v2/custom-fields');

  if (!isCrm2) return false;
  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is required for CRM 2.0 operations', code: 'PG_REQUIRED' });
    return true;
  }

  const tenantCtx = {
    agencyId: agency?.id,
    locationId: activeLocation?.id,
    actorId: actor?.user?.id || actor?.id || 'system'
  };

  if (method === 'GET' && pathname === '/api/crm/contacts/duplicates') {
    const groups = await runInTenantTx(pgPool, tenantCtx, (tx) => crm2Repo.findDuplicates(tx));
    sendJson(res, 200, { groups });
    return true;
  }

  if (method === 'POST' && pathname === '/api/crm/contacts/import/preview') {
    const body = await readBody(req);
    const parsed = parseAndValidateCsvImport(String(body?.csv || ''), body?.mapping || {});
    const existingDupes = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
      const resRows = await tx.query(
        `SELECT id, body->>'email' AS email, body->>'phone' AS phone FROM location_records
         WHERE agency_id = $1 AND location_id = $2 AND collection = 'contacts'`,
        [tx.agencyId, tx.locationId]
      );
      return resRows.rows;
    });
    const emailSet = new Set(existingDupes.map((r) => normalizeEmail(r.email)).filter(Boolean));
    const phoneSet = new Set(existingDupes.map((r) => normalizePhone(r.phone)).filter(Boolean));

    const preview = (parsed.records || []).slice(0, 100).map((row, idx) => {
      const normE = normalizeEmail(row.email);
      const normP = normalizePhone(row.phone);
      return {
        rowIndex: idx + 1,
        ...row,
        normalizedEmail: normE,
        normalizedPhone: normP,
        duplicateMatch: Boolean((normE && emailSet.has(normE)) || (normP && phoneSet.has(normP)))
      };
    });

    sendJson(res, 200, {
      dryRun: true,
      validCount: parsed.records?.length || 0,
      errors: parsed.errors || [],
      preview
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/crm/contacts/merge-safe') {
    const body = await readBody(req);
    try {
      const result = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        crm2Repo.mergeContactsSafely(tx, {
          primaryId: body?.primaryId,
          mergeIds: body?.mergeIds,
          mergedBy: tenantCtx.actorId
        })
      );
      auditLog?.('crm.contacts_merged', actor, { primaryId: result.primaryId, mergedCount: result.mergedIds.length });
      sendJson(res, 200, result);
      return true;
    } catch (err) {
      const status = err?.code === 'MERGE_CONFLICT' ? 409 : 400;
      sendJson(res, status, { error: err.message, code: err.code || 'MERGE_FAILED' });
      return true;
    }
  }

  if (method === 'GET' && pathname.startsWith('/api/crm/contacts/') && pathname.endsWith('/profile')) {
    const contactId = pathname.replace('/api/crm/contacts/', '').replace('/profile', '').trim();
    const q = url || new URL(req.url, 'http://localhost');
    const profile = await runInTenantTx(pgPool, tenantCtx, (tx) =>
      crm2Repo.getCustomer360Profile(tx, contactId, {
        timelineLimit: Number(q.searchParams.get('timelineLimit') || 25),
        timelineOffset: Number(q.searchParams.get('timelineOffset') || 0)
      })
    );
    if (!profile) {
      sendJson(res, 404, { error: 'Contact not found' });
      return true;
    }
    sendJson(res, 200, profile);
    return true;
  }

  if (method === 'GET' && pathname === '/api/crm/v2/smart-lists') {
    const smartLists = await runInTenantTx(pgPool, tenantCtx, (tx) => crm2Repo.listSmartLists(tx));
    sendJson(res, 200, { smartLists });
    return true;
  }

  if (method === 'POST' && pathname === '/api/crm/v2/smart-lists') {
    const body = await readBody(req);
    try {
      const smartList = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        crm2Repo.createSmartList(tx, {
          name: body?.name,
          description: body?.description,
          filterAst: body?.filterAst,
          createdBy: tenantCtx.actorId
        })
      );
      sendJson(res, 201, { smartList });
      return true;
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_SMART_LIST' });
      return true;
    }
  }

  if (method === 'GET' && pathname.startsWith('/api/crm/v2/smart-lists/') && pathname.endsWith('/evaluate')) {
    const id = pathname.replace('/api/crm/v2/smart-lists/', '').replace('/evaluate', '').trim();
    const resEval = await runInTenantTx(pgPool, tenantCtx, (tx) => crm2Repo.evaluateSmartList(tx, id));
    if (!resEval) {
      sendJson(res, 404, { error: 'Smart List not found' });
      return true;
    }
    sendJson(res, 200, resEval);
    return true;
  }

  if (method === 'GET' && pathname === '/api/crm/v2/custom-fields') {
    const fields = await runInTenantTx(pgPool, tenantCtx, (tx) => crm2Repo.listCustomFieldDefs(tx));
    sendJson(res, 200, { fields });
    return true;
  }

  if (method === 'POST' && pathname === '/api/crm/v2/custom-fields') {
    const body = await readBody(req);
    const field = await runInTenantTx(pgPool, tenantCtx, (tx) => crm2Repo.createCustomFieldDef(tx, body));
    sendJson(res, 201, { field });
    return true;
  }

  return false;
}
