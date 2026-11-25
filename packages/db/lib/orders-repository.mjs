/**
 * ============================================================================
 * Operza Orders Repository — Domain Boundary
 * ============================================================================
 * Encapsulates Order persistence strictly through TenantTx on `orders` table
 * (Migration 033) with integer minor-unit precision and idempotency keys.
 */

import { randomUUID } from 'node:crypto';
import { toCents, fromCents, validateCurrency } from './money.mjs';

const VALID_STATUSES = new Set([
  'pending', 'paid', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded'
]);

const ALLOWED_TRANSITIONS = new Map([
  ['pending', new Set(['paid', 'completed', 'failed', 'cancelled'])],
  ['paid', new Set(['completed', 'partially_refunded', 'refunded'])],
  ['completed', new Set(['partially_refunded', 'refunded'])],
  ['partially_refunded', new Set(['partially_refunded', 'refunded'])],
  ['failed', new Set(['pending', 'cancelled'])],
  ['cancelled', new Set()],
  ['refunded', new Set()]
]);

export function normalizeOrderRow(row) {
  if (!row) return null;
  const amountCents = Number(row.amount_cents ?? row.amountCents ?? 0);
  const originalAmountCents = Number(row.original_amount_cents ?? row.originalAmountCents ?? amountCents);
  const discountCents = Number(row.discount_cents ?? row.discountCents ?? 0);
  const taxCents = Number(row.tax_cents ?? row.taxCents ?? 0);
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    orderNumber: row.order_number || row.orderNumber,
    contactId: row.contact_id || row.contactId || null,
    opportunityId: row.opportunity_id || row.opportunityId || null,
    invoiceId: row.invoice_id || row.invoiceId || null,
    paymentLinkId: row.payment_link_id || row.paymentLinkId || null,
    contactName: row.contact_name || row.contactName || '',
    amountCents,
    amount: fromCents(amountCents),
    originalAmountCents,
    originalAmount: fromCents(originalAmountCents),
    discountCents,
    discount: fromCents(discountCents),
    taxCents,
    tax: fromCents(taxCents),
    currency: row.currency || 'USD',
    status: row.status || 'pending',
    items,
    couponCode: row.coupon_code || row.couponCode || undefined,
    idempotencyKey: row.idempotency_key || row.idempotencyKey || null,
    source: row.source || null,
    hasUpsell: Boolean(row.has_upsell ?? row.hasUpsell),
    paidAt: row.paid_at?.toISOString?.() || row.paid_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createOrdersRepository() {
  return {
    async createOrder(tx, data) {
      if (!data || typeof data !== 'object') {
        throw Object.assign(new Error('Order payload must be an object'), { code: 'INVALID_ORDER_PAYLOAD' });
      }

      const idempotencyKey = typeof data.idempotencyKey === 'string' && data.idempotencyKey.trim()
        ? data.idempotencyKey.trim()
        : null;

      if (idempotencyKey) {
        const dup = await tx.query(
          `SELECT * FROM orders WHERE agency_id = $1 AND location_id = $2 AND idempotency_key = $3`,
          [tx.agencyId, tx.locationId, idempotencyKey]
        );
        if (dup.rows.length > 0) {
          return normalizeOrderRow(dup.rows[0]);
        }
      }

      const amountCents = data.amountCents !== undefined
        ? (Number.isSafeInteger(data.amountCents) && data.amountCents >= 0 ? data.amountCents : toCents(data.amountCents))
        : toCents(data.amount ?? 0);
      const originalAmountCents = data.originalAmountCents !== undefined
        ? Number(data.originalAmountCents)
        : (data.originalAmount !== undefined ? toCents(data.originalAmount) : amountCents);
      const discountCents = data.discountCents !== undefined
        ? Number(data.discountCents)
        : (data.discount !== undefined ? toCents(data.discount) : 0);
      const taxCents = data.taxCents !== undefined
        ? Number(data.taxCents)
        : (data.tax !== undefined ? toCents(data.tax) : 0);
      const currency = validateCurrency(data.currency || 'USD');

      let status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'pending';
      if (!VALID_STATUSES.has(status)) {
        throw Object.assign(new Error(`Invalid order status: "${status}"`), { code: 'INVALID_ORDER_STATUS' });
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const orderNumber = data.orderNumber || `ORD-${Date.now().toString().slice(-6)}`;
      const items = Array.isArray(data.items) ? data.items : [];
      const paidAt = (status === 'paid' || status === 'completed') ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null;

      const res = await tx.query(
        `INSERT INTO orders (
          id, agency_id, location_id, order_number, contact_id, opportunity_id, invoice_id, payment_link_id,
          contact_name, amount_cents, original_amount_cents, discount_cents, tax_cents, currency,
          status, items, coupon_code, idempotency_key, source, has_upsell, paid_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14,
          $15, $16::jsonb, $17, $18, $19, $20, $21
        ) RETURNING *`,
        [
          assignedId,
          tx.agencyId,
          tx.locationId,
          orderNumber,
          data.contactId || null,
          data.opportunityId || null,
          data.invoiceId || null,
          data.paymentLinkId || null,
          data.contactName || '',
          amountCents,
          originalAmountCents,
          discountCents,
          taxCents,
          currency,
          status,
          JSON.stringify(items),
          data.couponCode || null,
          idempotencyKey,
          data.source || null,
          Boolean(data.hasUpsell),
          paidAt
        ]
      );
      return normalizeOrderRow(res.rows[0]);
    },

    async getOrderById(tx, id) {
      if (!id) return null;
      const res = await tx.query(
        `SELECT * FROM orders WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, id]
      );
      return res.rows.length > 0 ? normalizeOrderRow(res.rows[0]) : null;
    },

    async listOrders(tx, options = {}) {
      const conditions = ['agency_id = $1', 'location_id = $2'];
      const params = [tx.agencyId, tx.locationId];
      let pIdx = 3;

      if (options.status && VALID_STATUSES.has(options.status)) {
        conditions.push(`status = $${pIdx++}`);
        params.push(options.status);
      }
      if (options.contactId) {
        conditions.push(`contact_id = $${pIdx++}`);
        params.push(options.contactId);
      }

      const limit = Math.min(200, Math.max(1, Number(options.limit) || 50));
      const res = await tx.query(
        `SELECT * FROM orders WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${pIdx}`,
        [...params, limit]
      );
      return res.rows.map(normalizeOrderRow);
    },

    async addUpsellItem(tx, orderId, item, upsellCents) {
      const existing = await this.getOrderById(tx, orderId);
      if (!existing) return null;
      if (!Number.isSafeInteger(upsellCents) || upsellCents <= 0) {
        throw Object.assign(new Error('Upsell amount must be positive'), { code: 'INVALID_AMOUNT' });
      }
      const nextItems = [...(existing.items || []), item];
      const nextAmountCents = existing.amountCents + upsellCents;

      const res = await tx.query(
        `UPDATE orders SET amount_cents = $1, status = $2, items = $3::jsonb, has_upsell = $4, paid_at = $5, updated_at = now()
         WHERE agency_id = $6 AND location_id = $7 AND id = $8
         RETURNING *`,
        [
          nextAmountCents,
          existing.status,
          JSON.stringify(nextItems),
          true,
          existing.paidAt ? new Date(existing.paidAt) : null,
          tx.agencyId,
          tx.locationId,
          orderId
        ]
      );
      return res.rows.length > 0 ? normalizeOrderRow(res.rows[0]) : null;
    },

    async transitionStatus(tx, orderId, targetStatus) {
      const existing = await this.getOrderById(tx, orderId);
      if (!existing) return null;
      if (existing.status === targetStatus) return existing;

      const allowed = ALLOWED_TRANSITIONS.get(existing.status);
      if (!allowed || !allowed.has(targetStatus)) {
        throw Object.assign(new Error(`Invalid order status transition from "${existing.status}" to "${targetStatus}"`), {
          code: 'INVALID_STATUS_TRANSITION'
        });
      }

      const paidAt = (targetStatus === 'paid' || targetStatus === 'completed')
        ? (existing.paidAt ? new Date(existing.paidAt) : new Date())
        : (existing.paidAt ? new Date(existing.paidAt) : null);

      const res = await tx.query(
        `UPDATE orders SET amount_cents = $1, status = $2, items = $3::jsonb, has_upsell = $4, paid_at = $5, updated_at = now()
         WHERE agency_id = $6 AND location_id = $7 AND id = $8
         RETURNING *`,
        [
          existing.amountCents,
          targetStatus,
          JSON.stringify(existing.items || []),
          existing.hasUpsell,
          paidAt,
          tx.agencyId,
          tx.locationId,
          orderId
        ]
      );
      return res.rows.length > 0 ? normalizeOrderRow(res.rows[0]) : null;
    }
  };
}
