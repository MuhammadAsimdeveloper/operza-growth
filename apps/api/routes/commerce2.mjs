import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createCommerce2Repository } from '../../../packages/db/lib/commerce-2-repository.mjs';
import { calculateOrderTotals, evaluateDunningSchedule } from '../../../packages/platform-core/src/commerce-2-0.mjs';

const repo = createCommerce2Repository();

export async function handleCommerce2Routes({ req, res, pathname, method, ctx }) {
  if (!pathname.startsWith('/api/commerce/v2')) return false;

  const { pgPool, agency, activeLocation, actor, readBody, sendJson } = ctx;
  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Authentication required' });
    return true;
  }

  // Stateless minor-unit order calculator & dunning schedule preview
  if (method === 'POST' && pathname === '/api/commerce/v2/orders/calculate') {
    try {
      const body = await readBody(req);
      const totals = calculateOrderTotals({
        items: body.items || [],
        currency: body.currency || 'USD',
        coupon: body.coupon || null,
        explicitTaxCents: body.explicitTaxCents || 0
      });
      sendJson(res, 200, totals);
    } catch (err) {
      sendJson(res, 400, { error: err.message, code: err.code || 'INVALID_CALCULATION' });
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/commerce/v2/dunning/evaluate') {
    const body = await readBody(req);
    const plan = evaluateDunningSchedule({
      attemptCount: Number(body.attemptCount || 0),
      maxAttempts: Number(body.maxAttempts || 4),
      isPermanentDecline: body.isPermanentDecline === true
    });
    sendJson(res, 200, plan);
    return true;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is required for Commerce 2.0 persistence', code: 'DATABASE_UNAVAILABLE' });
    return true;
  }

  const tenantCtx = {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.id || actor?.userId || 'system'
  };

  try {
    if (method === 'GET' && pathname === '/api/commerce/v2/products') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listProducts(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/commerce/v2/products') {
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.createProduct(tx, body));
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'GET' && pathname === '/api/commerce/v2/refunds') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listRefunds(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/commerce/v2/refunds') {
      const body = await readBody(req);
      const result = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.requestRefund(tx, { ...body, actorId: tenantCtx.actorId })
      );
      sendJson(res, result.deduplicated ? 200 : 201, result);
      return true;
    }
    if (method === 'GET' && pathname === '/api/commerce/v2/ledger/verify') {
      const result = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.verifyLedgerIntegrity(tx));
      sendJson(res, 200, result);
      return true;
    }
    if (method === 'GET' && pathname === '/api/commerce/v2/reconciliation') {
      const report = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.getReconciliationReport(tx));
      sendJson(res, 200, report);
      return true;
    }
    if (method === 'POST' && pathname === '/api/commerce/v2/subscription/transition') {
      const body = await readBody(req);
      const updated = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.transitionSubscription(tx, { ...body, actorId: tenantCtx.actorId })
      );
      if (!updated) {
        sendJson(res, 404, { error: 'Subscription not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
    sendJson(res, 404, { error: 'Commerce 2.0 endpoint not found' });
    return true;
  } catch (err) {
    const code = err?.code || 'COMMERCE_ERROR';
    const status = [
      'INVALID_AMOUNT',
      'INVALID_CURRENCY',
      'REFUND_EXCEEDS_CAPTURED_AMOUNT',
      'REFUND_APPROVAL_REQUIRED',
      'INVALID_SUBSCRIPTION_TRANSITION'
    ].includes(code)
      ? 400
      : code === 'PAYMENT_NOT_FOUND'
      ? 404
      : 500;
    sendJson(res, status, { error: err.message, code });
    return true;
  }
}
