import { randomUUID } from 'node:crypto';
import {
  validateRefundEligibility,
  verifyLedgerEntriesChain,
  canTransitionSubscription,
  reconcileCommerceRecords,
  assertValidCurrency
} from '../../platform-core/src/commerce-2-0.mjs';
import { createLedgerRepository } from './ledger-repository.mjs';

const ledgerRepo = createLedgerRepository();

function scope(tx, agencyId, locationId) {
  const a = agencyId || tx?.agencyId;
  const l = locationId || tx?.locationId;
  if (!a || !l) throw new Error('Commerce2Repository requires agencyId and locationId');
  return { agencyId: a, locationId: l };
}

export function createCommerce2Repository() {
  return {
    async listProducts(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM commerce_products WHERE agency_id = $1 AND location_id = $2 ORDER BY updated_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async createProduct(tx, input = {}) {
      const s = scope(tx, input.agencyId, input.locationId);
      const priceCents = Number(input.priceCents);
      if (!Number.isSafeInteger(priceCents) || priceCents < 0) {
        throw Object.assign(new Error('priceCents must be a non-negative integer'), { code: 'INVALID_AMOUNT' });
      }
      const currency = assertValidCurrency(input.currency || 'USD');
      const res = await tx.query(
        `INSERT INTO commerce_products (
          agency_id, location_id, id, name, description, sku, price_cents, currency, product_type, status, tax_metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          input.id || randomUUID(),
          String(input.name || 'Product').trim(),
          String(input.description || ''),
          String(input.sku || `SKU-${randomUUID().slice(0, 8)}`).trim(),
          priceCents,
          currency,
          input.productType || 'one_time',
          input.status || 'active',
          JSON.stringify(input.taxMetadata || {})
        ]
      );
      return res.rows[0];
    },

    async requestRefund(tx, {
      agencyId,
      locationId,
      paymentId,
      orderId = null,
      invoiceId = null,
      amountCents,
      currency = 'USD',
      reason = 'requested_by_customer',
      idempotencyKey,
      approvedBy = null,
      actorId = 'system'
    } = {}) {
      const s = scope(tx, agencyId, locationId);
      const key = idempotencyKey || `ref_${paymentId}_${amountCents}`;
      const dup = await tx.query(
        `SELECT * FROM commerce_refunds WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3`,
        [s.agencyId, s.locationId, key]
      );
      if (dup.rows.length > 0) {
        return { refund: dup.rows[0], deduplicated: true };
      }

      const payRes = await tx.query(
        `SELECT * FROM payments WHERE agency_id = $1 AND location_id = $2 AND id = $3 FOR UPDATE`,
        [s.agencyId, s.locationId, paymentId]
      );
      const payment = payRes.rows[0];
      if (!payment) {
        throw Object.assign(new Error('Payment not found'), { code: 'PAYMENT_NOT_FOUND' });
      }
      const capturedCents = Number(payment.amount_cents ?? 0);
      const refSumRes = await tx.query(
        `SELECT COALESCE(SUM(amount_cents), 0)::int AS total
         FROM commerce_refunds
         WHERE agency_id = $1 AND location_id = $2 AND payment_id = $3 AND status IN ('approved','submitted','succeeded')`,
        [s.agencyId, s.locationId, paymentId]
      );
      const alreadyRefundedCents = Number(refSumRes.rows[0]?.total || 0);
      const check = validateRefundEligibility({
        capturedCents,
        alreadyRefundedCents,
        requestedCents: Number(amountCents),
        approvedBy
      });
      if (!check.eligible) {
        throw Object.assign(new Error(check.error), { code: check.code });
      }

      const ledgerRes = await ledgerRepo.recordTransaction(tx, {
        accountType: 'credit_balance',
        entryType: 'debit',
        amountCents: Number(amountCents),
        referenceType: 'refund_reversal',
        referenceId: paymentId,
        description: `Refund reversal (${reason})`,
        idempotencyKey: `ledger_${key}`,
        currency: assertValidCurrency(currency),
        allowOverdraft: true
      });

      const inserted = await tx.query(
        `INSERT INTO commerce_refunds (
          agency_id, location_id, id, payment_id, order_id, invoice_id,
          amount_cents, currency, reason, status, idempotency_key,
          approved_by, approved_at, ledger_entry_id, created_by
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING *`,
        [
          s.agencyId,
          s.locationId,
          randomUUID(),
          paymentId,
          orderId,
          invoiceId,
          Number(amountCents),
          assertValidCurrency(currency),
          reason,
          'approved',
          key,
          approvedBy || actorId,
          new Date().toISOString(),
          ledgerRes.entry.id,
          actorId
        ]
      );
      return { refund: inserted.rows[0], ledgerEntry: ledgerRes.entry, deduplicated: false };
    },

    async listRefunds(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const res = await tx.query(
        `SELECT * FROM commerce_refunds WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC`,
        [s.agencyId, s.locationId]
      );
      return res.rows;
    },

    async verifyLedgerIntegrity(tx, { agencyId, locationId, accountType = 'credit_balance' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const acc = await tx.query(
        `SELECT * FROM billing_ledger_accounts WHERE agency_id = $1 AND location_id = $2 AND account_type = $3`,
        [s.agencyId, s.locationId, accountType]
      );
      if (acc.rows.length === 0) {
        return { valid: true, count: 0, finalBalanceCents: 0 };
      }
      const entriesRes = await tx.query(
        `SELECT * FROM billing_ledger_entries WHERE agency_id = $1 AND location_id = $2 AND account_id = $3 ORDER BY created_at ASC, id ASC`,
        [s.agencyId, s.locationId, acc.rows[0].id]
      );
      return verifyLedgerEntriesChain(entriesRes.rows);
    },

    async transitionSubscription(tx, { agencyId, locationId, toStatus, planId = null, cancelAtPeriodEnd = null, actorId = 'system' } = {}) {
      const s = scope(tx, agencyId, locationId);
      const curRes = await tx.query(
        `SELECT * FROM saas_subscriptions WHERE agency_id = $1 AND location_id = $2 FOR UPDATE`,
        [s.agencyId, s.locationId]
      );
      const current = curRes.rows[0];
      if (!current) return null;
      if (!canTransitionSubscription(current.status, toStatus)) {
        throw Object.assign(new Error(`Invalid subscription transition: ${current.status} -> ${toStatus}`), {
          code: 'INVALID_SUBSCRIPTION_TRANSITION'
        });
      }
      const upd = await tx.query(
        `UPDATE saas_subscriptions
         SET status = $3,
             plan_id = COALESCE($4, plan_id),
             cancel_at_period_end = COALESCE($5, cancel_at_period_end),
             paused_at = CASE WHEN $3 = 'paused' THEN now() ELSE paused_at END,
             cancelled_at = CASE WHEN $3 = 'cancelled' THEN now() ELSE cancelled_at END,
             updated_at = now()
         WHERE agency_id = $1 AND location_id = $2
         RETURNING *`,
        [s.agencyId, s.locationId, toStatus, planId, cancelAtPeriodEnd]
      );
      await tx.query(
        `INSERT INTO saas_subscription_events (
          agency_id, location_id, id, subscription_id, event_type, from_status, to_status, from_plan_id, to_plan_id, actor_id
        ) VALUES ($1,$2,$3,$4,'lifecycle_transition',$5,$6,$7,$8,$9)`,
        [s.agencyId, s.locationId, randomUUID(), current.id, current.status, toStatus, current.plan_id, planId || current.plan_id, actorId]
      );
      return upd.rows[0];
    },

    async getReconciliationReport(tx, { agencyId, locationId } = {}) {
      const s = scope(tx, agencyId, locationId);
      const [payRes, invRes, ledRes] = await Promise.all([
        tx.query(`SELECT id, invoice_id, status, amount_cents, currency FROM payments WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT id, status, amount_cents, currency FROM invoices WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId]),
        tx.query(`SELECT id, reference_id, entry_type, amount_cents FROM billing_ledger_entries WHERE agency_id = $1 AND location_id = $2`, [s.agencyId, s.locationId])
      ]);
      return reconcileCommerceRecords({
        payments: payRes.rows,
        invoices: invRes.rows,
        ledgerEntries: ledRes.rows
      });
    }
  };
}
