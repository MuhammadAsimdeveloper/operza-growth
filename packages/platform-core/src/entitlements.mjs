const PLAN_CATALOG = Object.freeze({
  beta: Object.freeze({
    label: 'Operza Beta',
    pricing: null,
    limits: Object.freeze({ seats: 3, locations: 2, workflows: 25, monthlyWorkflowRuns: 500, monthlyAiRequests: 250, monthlyMessages: 0 }),
    features: Object.freeze({ crm: true, workflows: true, copilotRead: true, copilotProposals: true, providerConnections: true, liveMessaging: false, payments: false, marketplace: false, customDomains: false })
  }),
  studio: Object.freeze({
    label: 'Studio',
    pricing: null,
    limits: Object.freeze({ seats: 5, locations: 3, workflows: 50, monthlyWorkflowRuns: 1500, monthlyAiRequests: 1000, monthlyMessages: 0 }),
    features: Object.freeze({ crm: true, workflows: true, copilotRead: true, copilotProposals: true, providerConnections: true, liveMessaging: false, payments: false, marketplace: false, customDomains: false })
  }),
  growth: Object.freeze({
    label: 'Growth',
    pricing: null,
    limits: Object.freeze({ seats: 15, locations: 10, workflows: 250, monthlyWorkflowRuns: 15000, monthlyAiRequests: 7500, monthlyMessages: 0 }),
    features: Object.freeze({ crm: true, workflows: true, copilotRead: true, copilotProposals: true, providerConnections: true, liveMessaging: false, payments: false, marketplace: false, customDomains: true })
  }),
  enterprise: Object.freeze({
    label: 'Enterprise',
    pricing: null,
    limits: Object.freeze({ seats: 100, locations: 50, workflows: 2000, monthlyWorkflowRuns: 100000, monthlyAiRequests: 50000, monthlyMessages: 0 }),
    features: Object.freeze({ crm: true, workflows: true, copilotRead: true, copilotProposals: true, providerConnections: true, liveMessaging: false, payments: false, marketplace: false, customDomains: true })
  })
});

export function listPlans() {
  return Object.entries(PLAN_CATALOG).map(([id, plan]) => ({
    id, label: plan.label, pricing: null, limits: { ...plan.limits }, features: { ...plan.features }
  }));
}

export function resolveEntitlements({ planId = 'beta', featureOverrides = {}, limitOverrides = {} } = {}) {
  const plan = PLAN_CATALOG[planId] || PLAN_CATALOG.beta;
  const features = { ...plan.features };
  const limits = { ...plan.limits };
  for (const [key, value] of Object.entries(featureOverrides || {})) {
    if (key in features && typeof value === 'boolean') features[key] = value;
  }
  for (const [key, value] of Object.entries(limitOverrides || {})) {
    if (key in limits && Number.isSafeInteger(value) && value >= 0) limits[key] = value;
  }
  return { planId: PLAN_CATALOG[planId] ? planId : 'beta', label: plan.label, pricing: null, features, limits };
}

export function checkFeatureAccess(entitlements, feature) {
  if (!entitlements?.features || !(feature in entitlements.features)) return { allowed: false, code: 'FEATURE_UNKNOWN' };
  return entitlements.features[feature]
    ? { allowed: true, code: 'FEATURE_ENABLED' }
    : { allowed: false, code: 'FEATURE_DISABLED' };
}

export function checkUsageLimit(entitlements, usage, metric) {
  const limit = entitlements?.limits?.[metric];
  if (!Number.isSafeInteger(limit) || limit < 0) return { allowed: false, code: 'LIMIT_UNKNOWN' };
  const consumed = Number.isSafeInteger(usage?.[metric]) && usage[metric] >= 0 ? usage[metric] : 0;
  return consumed < limit
    ? { allowed: true, code: 'WITHIN_LIMIT', consumed, limit, remaining: limit - consumed }
    : { allowed: false, code: 'LIMIT_REACHED', consumed, limit, remaining: 0 };
}

export function createUsageEvent({ tenantId, locationId = null, eventId = crypto.randomUUID(), metric, quantity = 1, occurredAt = new Date().toISOString(), metadata = {} } = {}) {
  if (typeof tenantId !== 'string' || tenantId.length < 3 || typeof metric !== 'string' || !/^[a-z][a-zA-Z0-9_.-]{1,80}$/.test(metric)) {
    throw Object.assign(new TypeError('Usage event identity is invalid'), { code: 'INVALID_USAGE_EVENT' });
  }
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1_000_000) {
    throw Object.assign(new TypeError('Usage quantity must be a positive safe integer'), { code: 'INVALID_USAGE_QUANTITY' });
  }
  if (JSON.stringify(metadata).length > 2_000 || /secret|token|password|api[_-]?key/i.test(JSON.stringify(metadata))) {
    throw Object.assign(new TypeError('Usage metadata is oversized or sensitive'), { code: 'INVALID_USAGE_METADATA' });
  }
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) throw Object.assign(new TypeError('Usage timestamp is invalid'), { code: 'INVALID_USAGE_TIMESTAMP' });
  return { eventId, tenantId, locationId, metric, quantity, occurredAt: date.toISOString(), metadata: structuredClone(metadata) };
}

export function aggregateUsage(events = [], { tenantId, from, to } = {}) {
  const start = from ? Date.parse(from) : 0;
  const end = to ? Date.parse(to) : Date.now() + 1;
  const totals = {};
  const unique = new Set();
  for (const event of events) {
    if (event.tenantId !== tenantId || unique.has(event.eventId)) continue;
    const timestamp = Date.parse(event.occurredAt);
    if (!Number.isFinite(timestamp) || timestamp < start || timestamp >= end) continue;
    unique.add(event.eventId);
    totals[event.metric] = (totals[event.metric] || 0) + event.quantity;
  }
  return totals;
}
