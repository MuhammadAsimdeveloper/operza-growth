import { randomUUID } from 'node:crypto';

function mapCouponRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    agencyId: row.agency_id,
    locationId: row.location_id,
    code: row.code,
    discountType: row.discount_type,
    discountValue: Number(row.discount_value) || 0,
    active: Boolean(row.active),
    maxUses: row.max_uses ?? null,
    usesCount: Number(row.uses_count) || 0,
    expiresAt: row.expires_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createCouponsRepository() {
  return {
    async createCoupon(tx, input = {}) {
      const a = input.agencyId || tx?.agencyId;
      const l = input.locationId || tx?.locationId;
      const code = String(input.code || '').trim().toUpperCase();
      if (!code) throw new Error('Coupon code is required.');
      const discountType = input.discountType === 'fixed' ? 'fixed' : 'percent';
      const discountValue = Math.max(0, Number(input.discountValue) || 0);

      const res = await tx.query(
        `INSERT INTO coupons (
          id, agency_id, location_id, code, discount_type, discount_value,
          active, max_uses, expires_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          input.id || randomUUID(),
          a,
          l,
          code,
          discountType,
          discountValue,
          input.active !== false,
          input.maxUses ?? null,
          input.expiresAt || null
        ]
      );
      return mapCouponRow(res.rows[0]);
    },

    async redeemCoupon(tx, { agencyId, locationId, code, now = new Date() } = {}) {
      const a = agencyId || tx?.agencyId;
      const l = locationId || tx?.locationId;
      const res = await tx.query(
        'SELECT * FROM coupons WHERE agency_id = $1 AND location_id = $2 AND upper(code) = upper($3) LIMIT 1',
        [a, l, String(code || '').trim()]
      );
      const coupon = mapCouponRow(res.rows[0]);
      if (!coupon || !coupon.active) {
        throw Object.assign(new Error('Coupon not found or inactive'), { code: 'COUPON_INVALID' });
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= now.getTime()) {
        throw Object.assign(new Error('Coupon has expired'), { code: 'COUPON_EXPIRED' });
      }
      if (coupon.maxUses !== null && coupon.usesCount >= coupon.maxUses) {
        throw Object.assign(new Error('Coupon usage limit reached'), { code: 'COUPON_USAGE_LIMIT_REACHED' });
      }

      const upd = await tx.query(
        `UPDATE coupons SET uses_count = uses_count + 1, updated_at = now()
         WHERE agency_id = $1 AND location_id = $2 AND id = $3
           AND (max_uses IS NULL OR uses_count < max_uses)
         RETURNING *`,
        [a, l, coupon.id]
      );
      if (upd.rowCount === 0) {
        throw Object.assign(new Error('Coupon usage limit reached'), { code: 'COUPON_USAGE_LIMIT_REACHED' });
      }
      return mapCouponRow(upd.rows[0]);
    }
  };
}
