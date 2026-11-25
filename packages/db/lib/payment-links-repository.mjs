import { randomUUID } from 'node:crypto';
import { toCents, fromCents, validateCurrency } from './money.mjs';

function mapPaymentLinkRow(row) {
  if (!row) return null;
  const amountCents = Number(row.amount_cents ?? 0);
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    name: row.name,
    slug: row.slug,
    amountCents,
    amount: fromCents(amountCents),
    currency: row.currency || 'USD',
    description: row.description || '',
    active: Boolean(row.active),
    visits: Number(row.visits) || 0,
    maxUses: row.max_uses ?? null,
    usesCount: Number(row.uses_count) || 0,
    expiresAt: row.expires_at || null,
    productIds: row.product_ids || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createPaymentLinksRepository() {
  return {
    async listPaymentLinks(tx, { agencyId, locationId } = {}) {
      const a = agencyId || tx?.agencyId;
      const l = locationId || tx?.locationId;
      const res = await tx.query(
        'SELECT * FROM payment_links WHERE agency_id = $1 AND location_id = $2 ORDER BY created_at DESC',
        [a, l]
      );
      return res.rows.map(mapPaymentLinkRow);
    },

    async createPaymentLink(tx, input = {}) {
      const a = input.agencyId || tx?.agencyId;
      const l = input.locationId || tx?.locationId;
      const amountCents = input.amountCents !== undefined ? Number(input.amountCents) : toCents(input.amount ?? 0);
      const currency = validateCurrency(input.currency || 'USD');
      const res = await tx.query(
        `INSERT INTO payment_links (
          id, agency_id, location_id, name, slug, amount_cents, currency,
          description, active, max_uses, expires_at, product_ids
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
        RETURNING *`,
        [
          input.id || randomUUID(),
          a,
          l,
          String(input.name || 'Payment Link').trim(),
          String(input.slug || randomUUID().slice(0, 8)).trim().toLowerCase(),
          amountCents,
          currency,
          String(input.description || ''),
          input.active !== false,
          input.maxUses ?? null,
          input.expiresAt || null,
          JSON.stringify(Array.isArray(input.productIds) ? input.productIds : [])
        ]
      );
      return mapPaymentLinkRow(res.rows[0]);
    },

    async getBySlug(tx, { agencyId, locationId, slug } = {}) {
      const a = agencyId || tx?.agencyId;
      const l = locationId || tx?.locationId;
      const res = await tx.query(
        'SELECT * FROM payment_links WHERE agency_id = $1 AND location_id = $2 AND slug = $3 LIMIT 1',
        [a, l, String(slug || '').trim().toLowerCase()]
      );
      return mapPaymentLinkRow(res.rows[0]);
    }
  };
}
