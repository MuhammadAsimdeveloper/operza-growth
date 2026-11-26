/**
 * Phase 7 — SaaS Subscriptions & Server-Side Entitlements Repository (TenantTx)
 * Persists subscription lifecycle (`trialing`, `active`, `past_due`, `paused`,
 * `cancelled`, `expired`), enforces grace periods, and resolves authoritative
 * server-side entitlements without trusting client-supplied tiers.
 */

import { randomUUID } from 'node:crypto';
import { resolveEntitlements, checkFeatureAccess } from '../../platform-core/src/entitlements.mjs';

const VALID_STATUSES = new Set(['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired']);

export function isSubscriptionActive(sub, now = Date.now()) {
  if (!sub) return false;
  if (sub.status === 'active') return true;
  if (sub.status === 'trialing') {
    return !sub.trial_ends_at || new Date(sub.trial_ends_at).getTime() > now;
  }
  if (sub.status === 'past_due') {
    return Boolean(sub.grace_period_ends_at && new Date(sub.grace_period_ends_at).getTime() > now);
  }
  return false;
}

export function createSaasSubscriptionsRepository() {
  return {
    async upsertSubscription(tx, {
      id = randomUUID(),
      planId = 'beta',
      status = 'trialing',
      trialDays = 14,
      stripeSubscriptionId = null,
      gracePeriodDays = 7
    } = {}) {
      if (!VALID_STATUSES.has(status)) {
        throw Object.assign(new TypeError(`Invalid subscription status: ${status}`), { code: 'INVALID_SUBSCRIPTION_STATUS' });
      }
      const ent = resolveEntitlements({ planId });
      const now = Date.now();
      const trialEndsAt = status === 'trialing' ? new Date(now + trialDays * 86400_000) : null;
      const graceEndsAt = status === 'past_due' ? new Date(now + gracePeriodDays * 86400_000) : null;
      const cancelledAt = status === 'cancelled' ? new Date(now) : null;

      const res = await tx.query(
        `INSERT INTO saas_subscriptions (
          agency_id, location_id, id, plan_id, status, seat_limit, location_limit,
          trial_ends_at, grace_period_ends_at, stripe_subscription_id, cancelled_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (agency_id, location_id) DO UPDATE SET
          plan_id = EXCLUDED.plan_id,
          status = EXCLUDED.status,
          seat_limit = EXCLUDED.seat_limit,
          location_limit = EXCLUDED.location_limit,
          trial_ends_at = COALESCE(EXCLUDED.trial_ends_at, saas_subscriptions.trial_ends_at),
          grace_period_ends_at = EXCLUDED.grace_period_ends_at,
          stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, saas_subscriptions.stripe_subscription_id),
          cancelled_at = EXCLUDED.cancelled_at,
          updated_at = now()
        RETURNING *`,
        [
          tx.agencyId,
          tx.locationId,
          id,
          ent.planId,
          status,
          ent.limits.seats,
          ent.limits.locations,
          trialEndsAt,
          graceEndsAt,
          stripeSubscriptionId,
          cancelledAt
        ]
      );
      return res.rows[0];
    },

    async getSubscription(tx) {
      const res = await tx.query(
        `SELECT * FROM saas_subscriptions WHERE agency_id = $1 AND location_id = $2`,
        [tx.agencyId, tx.locationId]
      );
      return res.rows[0] || null;
    },

    async assertFeatureEntitled(tx, featureName, { now = Date.now() } = {}) {
      const sub = await this.getSubscription(tx);
      if (!sub || !isSubscriptionActive(sub, now)) {
        throw Object.assign(new Error('Active subscription is required'), {
          code: 'SUBSCRIPTION_INACTIVE',
          status: sub?.status || 'none'
        });
      }
      const ent = resolveEntitlements({ planId: sub.plan_id });
      const check = checkFeatureAccess(ent, featureName);
      if (!check.allowed) {
        throw Object.assign(new Error(`Plan '${ent.planId}' does not include '${featureName}'`), {
          code: 'FEATURE_NOT_ENTITLED',
          feature: featureName,
          planId: ent.planId
        });
      }
      return { subscription: sub, entitlements: ent };
    },

    async assertSeatLimit(tx, currentSeatsCount) {
      const sub = await this.getSubscription(tx);
      const limit = sub ? Number(sub.seat_limit) : 3;
      if (Number(currentSeatsCount) >= limit) {
        throw Object.assign(new Error(`Seat limit (${limit}) reached for current plan`), {
          code: 'SEAT_LIMIT_EXCEEDED',
          limit
        });
      }
      return { allowed: true, limit };
    }
  };
}
