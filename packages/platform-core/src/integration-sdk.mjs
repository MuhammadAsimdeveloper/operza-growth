import { CONNECTOR_CATALOG } from './connector-catalog.mjs';
import { createProviderAdapterRegistry } from './provider-adapters.mjs';

const VALID_INTEGRATION_STATUSES = new Set([
  'catalog_only',
  'adapter_implemented',
  'configuration_validated',
  'sandbox_connected',
  'trigger_verified',
  'actions_verified',
  'webhooks_verified',
  'production_connected'
]);

/**
 * Reusable Integration Hub SDK providing standardized registration,
 * schema/config validation, connection testing, per-tenant rate limiting,
 * idempotent action execution, and secret-safe error normalization.
 */
export function createIntegrationHubSdk({
  defaultRateLimit = { maxRequests: 60, windowMs: 60_000 },
  registerDefaults = true
} = {}) {
  const registry = new Map();
  const rateBuckets = new Map();
  const idempotencyCache = new Map();

  function checkTenantRateLimit(integrationId, tenantId = 'default', policy = defaultRateLimit) {
    const maxRequests = Math.max(1, Number(policy?.maxRequests) || 60);
    const windowMs = Math.max(1000, Number(policy?.windowMs) || 60_000);
    const key = `${integrationId}:${tenantId}`;
    const now = Date.now();
    const bucket = rateBuckets.get(key) || { count: 0, resetAt: now + windowMs };
    if (now >= bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + windowMs;
    }
    if (bucket.count >= maxRequests) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    bucket.count += 1;
    rateBuckets.set(key, bucket);
    return { allowed: true, remaining: maxRequests - bucket.count };
  }

  const sdk = {
    register(definition) {
      if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) {
        throw new Error('Integration definition requires a non-empty string id.');
      }
      const status = VALID_INTEGRATION_STATUSES.has(definition.status)
        ? definition.status
        : 'catalog_only';

      const normalized = Object.freeze({
        id: definition.id.trim(),
        name: definition.name || definition.id,
        provider: definition.provider || definition.id,
        version: definition.version || '1.0.0',
        authType: definition.authType || 'api_key',
        status,
        triggers: Array.isArray(definition.triggers) ? [...definition.triggers] : [],
        actions: definition.actions && typeof definition.actions === 'object' ? { ...definition.actions } : {},
        webhooks: Boolean(definition.webhooks),
        rateLimitPolicy: definition.rateLimitPolicy || defaultRateLimit,
        validateConfig: typeof definition.validateConfig === 'function' ? definition.validateConfig : () => ({ valid: true }),
        testConnection: typeof definition.testConnection === 'function' ? definition.testConnection : async () => ({ ok: false, code: 'NOT_IMPLEMENTED' }),
        documentationUrl: definition.documentationUrl || null
      });
      registry.set(normalized.id, normalized);
      return normalized;
    },

    get(id) {
      return registry.get(id) || null;
    },

    list() {
      return [...registry.values()];
    },

    validateConfig(id, config = {}) {
      const integration = registry.get(id);
      if (!integration) return { valid: false, error: `Unknown integration: ${id}` };
      return integration.validateConfig(config);
    },

    async testConnection(id, { secret = null, config = {}, fetchFn = globalThis.fetch } = {}) {
      const integration = registry.get(id);
      if (!integration) return { ok: false, code: 'INTEGRATION_NOT_FOUND' };
      try {
        return await integration.testConnection({ secret, config, fetchFn });
      } catch (err) {
        return { ok: false, code: 'CONNECTION_TEST_FAILED', error: err?.message || 'Connection test failed' };
      }
    },

    async executeAction(id, actionKey, {
      tenantId = 'default',
      secret = null,
      config = {},
      input = {},
      idempotencyKey = null,
      fetchFn = globalThis.fetch
    } = {}) {
      const integration = registry.get(id);
      if (!integration) {
        return { ok: false, code: 'INTEGRATION_NOT_FOUND' };
      }
      const action = integration.actions[actionKey];
      if (!action || typeof action.execute !== 'function') {
        return { ok: false, code: 'ACTION_NOT_IMPLEMENTED' };
      }

      if (idempotencyKey) {
        const cacheKey = `${tenantId}:${id}:${actionKey}:${idempotencyKey}`;
        if (idempotencyCache.has(cacheKey)) {
          return { ...idempotencyCache.get(cacheKey), deduplicated: true };
        }
      }

      const requiredFields = Array.isArray(action.requiredFields) ? action.requiredFields : [];
      for (const field of requiredFields) {
        if (input[field] === undefined || input[field] === null || String(input[field]).trim() === '') {
          return { ok: false, code: 'VALIDATION_ERROR', error: `Missing required field: ${field}` };
        }
      }

      const limit = checkTenantRateLimit(id, tenantId, integration.rateLimitPolicy);
      if (!limit.allowed) {
        return { ok: false, code: 'RATE_LIMIT_EXCEEDED', retryAfterMs: limit.retryAfterMs };
      }

      try {
        const output = await action.execute({ tenantId, secret, config, input, idempotencyKey, fetchFn });
        const result = { ok: true, integrationId: id, actionKey, output, deduplicated: false };
        if (idempotencyKey) {
          idempotencyCache.set(`${tenantId}:${id}:${actionKey}:${idempotencyKey}`, result);
        }
        return result;
      } catch (err) {
        return { ok: false, code: err?.code || 'ACTION_EXECUTION_FAILED', error: err?.message || 'Action failed' };
      }
    }
  };

  if (registerDefaults) {
    const adapterRegistry = createProviderAdapterRegistry();
    for (const adapter of adapterRegistry.list()) {
      sdk.register({
        id: adapter.providerKey,
        name: adapter.providerKey,
        provider: adapter.providerKey,
        version: '2.0.0',
        authType: 'api_key',
        status: adapter.providerKey === 'payments.stripe' ? 'sandbox_connected' : 'adapter_implemented',
        webhooks: ['payments.stripe', 'sms.twilio', 'email.sendgrid', 'whatsapp.meta_cloud', 'zapier'].includes(adapter.providerKey),
        actions: {
          dispatch: {
            description: `Execute ${adapter.providerKey} dispatch`,
            async execute({ tenantId, secret, config, input, fetchFn }) {
              return adapter.dispatch({ tenantId, secret, config, payload: input, fetchFn });
            }
          }
        },
        async testConnection({ secret, config, fetchFn }) {
          const res = await adapter.verify({ secret, config, fetchFn });
          return { ok: Boolean(res?.verified), ...res };
        }
      });
    }

    for (const item of CONNECTOR_CATALOG) {
      if (!sdk.get(item.id)) {
        sdk.register({
          id: item.id,
          name: item.name,
          provider: item.id,
          version: '1.0.0',
          authType: item.authType,
          status: 'catalog_only',
          triggers: item.supportedTriggers,
          documentationUrl: item.documentationUrl
        });
      }
    }
  }

  return sdk;
}
