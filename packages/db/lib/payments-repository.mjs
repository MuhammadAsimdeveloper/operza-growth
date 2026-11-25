/**
 * ============================================================================
 * Operza Payments Repository — Domain Boundary
 * ============================================================================
 * Encapsulates Payment persistence strictly through TenantTx on `payments` table
 * (Migration 033) with idempotency keys, provider event deduplication, and refund bounds.
 */

import { randomUUID } from 'node:crypto';
import { toCents, fromCents, validateCurrency } from './money.mjs';

const VALID_STATUSES = new Set([
  'pending', 'processing', 'succeeded', 'failed', 'cancelled', 'partially_refunded', 'refunded'
]);

const ALLOWED_TRANSITIONS = new Map([
  ['pending', new Set(['processing', 'succeeded', 'failed', 'cancelled'])],
  ['processing', new Set(['succeeded', 'failed', 'cancelled'])],
  ['succeeded', new Set(['partially_refunded', 'refunded'])],
  ['partially_refunded', new Set(['partially_refunded', 'refunded'])],
  ['failed', new Set()],
  ['cancelled', new Set()],
  ['refunded', new Set()]
]);

export function normalizePaymentRow(row) {
  if (!row) return null;
  const amountCents = Number(row.amount_cents ?? row.amountCents ?? 0);
  const refundedCents = Number(row.refunded_cents ?? row.refundedCents ?? 0);

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    orderId: row.order_id || row.orderId || null,
    invoiceId: row.invoice_id || row.invoiceId || null,
    contactId: row.contact_id || row.contactId || null,
    amountCents,
    amount: fromCents(amountCents),
    refundedCents,
    refunded: fromCents(refundedCents),
    currency: row.currency || 'USD',
    status: row.status || 'pending',
    provider: row.provider || 'simulated',
    providerPaymentId: row.provider_payment_id || row.providerPaymentId || null,
    providerEventId: row.provider_event_id || row.providerEventId || null,
    idempotencyKey: row.idempotency_key || row.idempotencyKey || null,
    method: row.method || null,
    failureCode: row.failure_code || row.failureCode || null,
    failureMessage: row.failure_message || row.failureMessage || null,
    metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : (row.metadata || {}),
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createPaymentsRepository() {
  return {
    async createPayment(tx, data) {
      if (!data || typeof data !== 'object') {
        throw Object.assign(new Error('Payment payload must be an object'), { code: 'INVALID_PAYMENT_PAYLOAD' });
      }

      const idempotencyKey = typeof data.idempotencyKey === 'string' && data.idempotencyKey.trim()
        ? data.idempotencyKey.trim()
        : null;

      if (idempotencyKey) {
        const dup = await tx.query(
          `SELECT * FROM payments WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3`,
          [tx.agencyId, tx.locationId, idempotencyKey]
        );
        if (dup.rows.length > 0) {
          return normalizePaymentRow(dup.rows[0]);
        }
      }

      const amountCents = data.amountCents !== undefined
        ? (Number.isSafeInteger(data.amountCents) && data.amountCents >= 0 ? data.amountCents : toCents(data.amountCents))
        : toCents(data.amount ?? 0);
      const currency = validateCurrency(data.currency || 'USD');
      const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'pending';
      if (!VALID_STATUSES.has(status)) {
        throw Object.assign(new Error(`Invalid payment status: "${status}"`), { code: 'INVALID_PAYMENT_STATUS' });
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();

      const res = await tx.query(
        `INSERT INTO payments (
          id, agency_id, location_id, order_id, invoice_id, contact_id,
          amount_cents, refunded_cents, currency, status, provider,
          provider_payment_id, provider_event_id, idempotency_key,
          method, failure_code, failure_message, metadata
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, 0, $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16, $17::jsonb
        ) RETURNING *`,
        [
          assignedId,
          tx.agencyId,
          tx.locationId,
          data.orderId || null,
          data.invoiceId || null,
          data.contactId || null,
          amountCents,
          currency,
          status,
          data.provider || 'simulated',
          data.providerPaymentId || null,
          data.providerEventId || null,
          idempotencyKey,
          data.method || null,
          data.failureCode || null,
          data.failureMessage || null,
          JSON.stringify(data.metadata || {})
        ]
      );
      return normalizePaymentRow(res.rows[0]);
    },

    async getPaymentById(tx, id) {
      if (!id) return null;
      const res = await tx.query(
        `SELECT * FROM payments WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, id]
      );
      return res.rows.length > 0 ? normalizePaymentRow(res.rows[0]) : null;
    },

    async listPayments(tx, options = {}) {
      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.orderId) {
        conditions.push(`order_id = $${pIdx++}`);
        params.push(options.orderId);
      }
      if (options.status && VALID_STATUSES.has(options.status)) {
        conditions.push(`status = $${pIdx++}`);
        params.push(options.status);
      }

      const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
      const res = await tx.query(
        `SELECT * FROM payments WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${pIdx}`,
        [...params, limit]
      );
      return res.rows.map(normalizePaymentRow);
    },

    async recordProviderEvent(tx, { paymentId, providerPaymentId = null, providerEventId = null, status, failureCode = null, failureMessage = null }) {
      if (providerEventId) {
        const dup = await tx.query(
          `SELECT * FROM payments WHERE agency_id = $1 AND provider_event_id = $2`,
          [tx.agencyId, providerEventId]
        );
        if (dup.rows.length > 0) {
          return { ...normalizePaymentRow(dup.rows[0]), deduplicated: true };
        }
      }

      const existing = await this.getPaymentById(tx, paymentId);
      if (!existing) return null;

      if (existing.status !== status) {
        const allowed = ALLOWED_TRANSITIONS.get(existing.status);
        if (!allowed || !allowed.has(status)) {
          throw Object.assign(new Error(`Invalid payment status transition from "${existing.status}" to "${status}"`), {
            code: 'INVALID_STATUS_TRANSITION'
          });
        }
      }

      const res = await tx.query(
        `UPDATE payments SET
          refunded_cents = $1, status = $2, provider_payment_id = $3,
          provider_event_id = $4, failure_code = $5, failure_message = $6, updated_at = now()
         WHERE agency_id = $7 AND location_id = $8 AND id = $9
         RETURNING *`,
        [
          existing.refundedCents,
          status,
          providerPaymentId || existing.providerPaymentId,
          providerEventId || existing.providerEventId,
          failureCode,
          failureMessage,
          tx.agencyId,
          tx.locationId,
          paymentId
        ]
      );
      return res.rows.length > 0 ? normalizePaymentRow(res.rows[0]) : null;
    },

    async recordRefund(tx, paymentId, { refundCents, providerEventId = null }) {
      const existing = await this.getPaymentById(tx, paymentId);
      if (!existing) return null;

      if (!['succeeded', 'partially_refunded'].includes(existing.status)) {
        throw Object.assign(new Error(`Cannot refund payment in status "${existing.status}"`), {
          code: 'INVALID_STATUS_TRANSITION'
        });
      }

      const cents = Number.isSafeInteger(refundCents) ? refundCents : toCents(refundCents, { allowZero: false });
      if (cents <= 0) {
        throw Object.assign(new Error('Refund amount must be positive'), { code: 'INVALID_AMOUNT' });
      }
      if (existing.refundedCents + cents > existing.amountCents) {
        throw Object.assign(new Error('Refund exceeds payment amount'), { code: 'REFUND_EXCEEDS_AMOUNT' });
      }

      const nextRefunded = existing.refundedCents + cents;
      const nextStatus = nextRefunded === existing.amountCents ? 'refunded' : 'partially_refunded';

      const res = await tx.query(
        `UPDATE payments SET
          refunded_cents = $1, status = $2, provider_payment_id = $3,
          provider_event_id = $4, failure_code = $5, failure_message = $6, updated_at = now()
         WHERE agency_id = $7 AND location_id = $8 AND id = $9
         RETURNING *`,
        [
          nextRefunded,
          nextStatus,
          existing.providerPaymentId,
          providerEventId || existing.providerEventId,
          existing.failureCode,
          existing.failureMessage,
          tx.agencyId,
          tx.locationId,
          paymentId
        ]
      );
      return res.rows.length > 0 ? normalizePaymentRow(res.rows[0]) : null;
    }
  };
}
