/**
 * ============================================================================
 * Operza Invoices Repository — Domain Boundary
 * ============================================================================
 * Encapsulates Invoice persistence strictly through TenantTx on `invoices` table
 * (Migration 033) with validated draft/issued/paid/void transitions.
 */

import { randomUUID } from 'node:crypto';
import { toCents, fromCents, validateCurrency } from './money.mjs';

const VALID_STATUSES = new Set(['draft', 'issued', 'paid', 'overdue', 'void', 'cancelled']);

export function normalizeInvoiceRow(row) {
  if (!row) return null;
  const amountCents = Number(row.amount_cents ?? row.amountCents ?? 0);
  const paidCents = Number(row.paid_cents ?? row.paidCents ?? 0);
  const taxCents = Number(row.tax_cents ?? row.taxCents ?? 0);
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : (row.items || []);

  return {
    id: row.id,
    agencyId: row.agency_id || row.agencyId,
    locationId: row.location_id || row.locationId,
    number: row.invoice_number || row.number,
    invoiceNumber: row.invoice_number || row.number,
    orderId: row.order_id || row.orderId || null,
    contactId: row.contact_id || row.contactId || null,
    contactName: row.contact_name || row.contactName || '',
    amountCents,
    amount: fromCents(amountCents),
    paidCents,
    paidAmount: fromCents(paidCents),
    taxCents,
    tax: fromCents(taxCents),
    currency: row.currency || 'USD',
    status: row.status || 'draft',
    items,
    dueDate: row.due_date?.toISOString?.()?.slice(0, 10) || row.due_date || null,
    description: row.description || '',
    paymentMethod: row.payment_method || row.paymentMethod || null,
    paidAt: row.paid_at?.toISOString?.() || row.paid_at || null,
    createdAt: row.created_at?.toISOString?.() || row.created_at,
    updatedAt: row.updated_at?.toISOString?.() || row.updated_at
  };
}

export function createInvoicesRepository() {
  return {
    async createInvoice(tx, data) {
      if (!data || typeof data !== 'object') {
        throw Object.assign(new Error('Invoice payload must be an object'), { code: 'INVALID_INVOICE_PAYLOAD' });
      }

      const amountCents = data.amountCents !== undefined
        ? (Number.isSafeInteger(data.amountCents) && data.amountCents >= 0 ? data.amountCents : toCents(data.amountCents))
        : toCents(data.amount ?? 0);
      const paidCents = data.paidCents !== undefined ? Number(data.paidCents) : 0;
      const taxCents = data.taxCents !== undefined ? Number(data.taxCents) : toCents(data.tax ?? 0);
      const currency = validateCurrency(data.currency || 'USD');

      const status = typeof data.status === 'string' ? data.status.trim().toLowerCase() : 'draft';
      if (!VALID_STATUSES.has(status)) {
        throw Object.assign(new Error(`Invalid invoice status: "${status}"`), { code: 'INVALID_INVOICE_STATUS' });
      }

      const assignedId = (typeof data.id === 'string' && data.id.trim()) ? data.id.trim() : randomUUID();
      const invoiceNumber = data.number || data.invoiceNumber || `INV-${Date.now().toString().slice(-6)}`;
      const paidAt = status === 'paid' ? (data.paidAt ? new Date(data.paidAt) : new Date()) : null;
      const effectivePaidCents = status === 'paid' && paidCents === 0 ? amountCents : paidCents;

      const res = await tx.query(
        `INSERT INTO invoices (
          id, agency_id, location_id, invoice_number, order_id, contact_id, contact_name,
          amount_cents, paid_cents, tax_cents, currency, status, items,
          due_date, description, payment_method, paid_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10, $11, $12, $13::jsonb,
          $14, $15, $16, $17
        ) RETURNING *`,
        [
          assignedId,
          tx.agencyId,
          tx.locationId,
          invoiceNumber,
          data.orderId || null,
          data.contactId || null,
          data.contactName || '',
          amountCents,
          effectivePaidCents,
          taxCents,
          currency,
          status,
          JSON.stringify(Array.isArray(data.items) ? data.items : []),
          data.dueDate || new Date().toISOString().slice(0, 10),
          data.description || '',
          data.paymentMethod || null,
          paidAt
        ]
      );
      return normalizeInvoiceRow(res.rows[0]);
    },

    async getInvoiceById(tx, id) {
      if (!id) return null;
      const res = await tx.query(
        `SELECT * FROM invoices WHERE agency_id = $1 AND location_id = $2 AND id = $3`,
        [tx.agencyId, tx.locationId, id]
      );
      return res.rows.length > 0 ? normalizeInvoiceRow(res.rows[0]) : null;
    },

    async listInvoices(tx, options = {}) {
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
        `SELECT * FROM invoices WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${pIdx}`,
        [...params, limit]
      );
      return res.rows.map(normalizeInvoiceRow);
    },

    async updateDraftInvoice(tx, id, patch) {
      const existing = await this.getInvoiceById(tx, id);
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw Object.assign(new Error(`Cannot edit invoice in status "${existing.status}"; only draft invoices are editable`), {
          code: 'INVOICE_NOT_DRAFT'
        });
      }

      const amountCents = patch.amountCents !== undefined
        ? Number(patch.amountCents)
        : (patch.amount !== undefined ? toCents(patch.amount) : existing.amountCents);
      const items = Array.isArray(patch.items) ? patch.items : existing.items;
      const description = patch.description !== undefined ? String(patch.description) : existing.description;

      const res = await tx.query(
        `UPDATE invoices SET amount_cents = $1, paid_cents = $2, status = $3, items = $4::jsonb,
          description = $5, payment_method = $6, paid_at = $7, updated_at = now()
         WHERE agency_id = $8 AND location_id = $9 AND id = $10
         RETURNING *`,
        [
          amountCents,
          existing.paidCents,
          existing.status,
          JSON.stringify(items),
          description,
          existing.paymentMethod,
          null,
          tx.agencyId,
          tx.locationId,
          id
        ]
      );
      return res.rows.length > 0 ? normalizeInvoiceRow(res.rows[0]) : null;
    },

    async issueInvoice(tx, id) {
      const existing = await this.getInvoiceById(tx, id);
      if (!existing) return null;
      if (existing.status !== 'draft') {
        throw Object.assign(new Error(`Cannot issue invoice from status "${existing.status}"`), {
          code: 'INVALID_STATUS_TRANSITION'
        });
      }
      const res = await tx.query(
        `UPDATE invoices SET amount_cents = $1, paid_cents = $2, status = $3, items = $4::jsonb,
          description = $5, payment_method = $6, paid_at = $7, updated_at = now()
         WHERE agency_id = $8 AND location_id = $9 AND id = $10
         RETURNING *`,
        [
          existing.amountCents,
          existing.paidCents,
          'issued',
          JSON.stringify(existing.items || []),
          existing.description,
          existing.paymentMethod,
          null,
          tx.agencyId,
          tx.locationId,
          id
        ]
      );
      return res.rows.length > 0 ? normalizeInvoiceRow(res.rows[0]) : null;
    },

    async recordPaymentAllocation(tx, id, { paidCents, paymentMethod = 'card' }) {
      const existing = await this.getInvoiceById(tx, id);
      if (!existing) return null;
      if (['void', 'cancelled'].includes(existing.status)) {
        throw Object.assign(new Error(`Cannot pay invoice in status "${existing.status}"`), {
          code: 'INVALID_STATUS_TRANSITION'
        });
      }
      const cents = Number.isSafeInteger(paidCents) ? paidCents : toCents(paidCents, { allowZero: false });
      const nextPaid = existing.paidCents + cents;
      const nextStatus = nextPaid >= existing.amountCents ? 'paid' : existing.status;
      const paidAt = nextStatus === 'paid' ? new Date() : null;

      const res = await tx.query(
        `UPDATE invoices SET amount_cents = $1, paid_cents = $2, status = $3, items = $4::jsonb,
          description = $5, payment_method = $6, paid_at = $7, updated_at = now()
         WHERE agency_id = $8 AND location_id = $9 AND id = $10
         RETURNING *`,
        [
          existing.amountCents,
          nextPaid,
          nextStatus,
          JSON.stringify(existing.items || []),
          existing.description,
          paymentMethod,
          paidAt,
          tx.agencyId,
          tx.locationId,
          id
        ]
      );
      return res.rows.length > 0 ? normalizeInvoiceRow(res.rows[0]) : null;
    },

    async voidInvoice(tx, id) {
      const existing = await this.getInvoiceById(tx, id);
      if (!existing) return null;
      if (existing.status === 'paid') {
        throw Object.assign(new Error('Cannot void a paid invoice; issue a refund instead'), {
          code: 'INVALID_STATUS_TRANSITION'
        });
      }
      const res = await tx.query(
        `UPDATE invoices SET amount_cents = $1, paid_cents = $2, status = $3, items = $4::jsonb,
          description = $5, payment_method = $6, paid_at = $7, updated_at = now()
         WHERE agency_id = $8 AND location_id = $9 AND id = $10
         RETURNING *`,
        [
          existing.amountCents,
          existing.paidCents,
          'void',
          JSON.stringify(existing.items || []),
          existing.description,
          existing.paymentMethod,
          null,
          tx.agencyId,
          tx.locationId,
          id
        ]
      );
      return res.rows.length > 0 ? normalizeInvoiceRow(res.rows[0]) : null;
    }
  };
}
