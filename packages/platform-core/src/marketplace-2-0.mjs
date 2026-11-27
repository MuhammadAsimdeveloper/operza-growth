/**
 * ============================================================================
 * Operza Marketplace & Developer Ecosystem 2.0 Core Engine
 * ============================================================================
 * Strict manifest validation, semver compatibility checks, app/install
 * lifecycle transitions, scope-upgrade consent detection, and minor-unit pricing.
 */

export const APP_TYPES = Object.freeze([
  'native_integration',
  'external_connector',
  'workflow_extension',
  'ai_agent_extension',
  'ai_tool',
  'reporting_extension',
  'business_template',
  'workflow_template',
  'automation_package'
]);

export const EXECUTABLE_APP_TYPES = new Set([
  'native_integration',
  'external_connector',
  'workflow_template',
  'business_template',
  'automation_package'
]);

export const PRICING_MODELS = Object.freeze(['free', 'one_time', 'subscription', 'usage_based', 'freemium']);

export const ALLOWED_SCOPES = new Set([
  'contacts:read', 'contacts:write',
  'opportunities:read', 'opportunities:write',
  'workflows:trigger', 'workflows:execute',
  'reports:read', 'communications:send',
  'tasks:write', 'knowledge:read'
]);

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,60}$/;
const FORBIDDEN_CODE_RE = /(\beval\s*\(|\bnew\s+Function\b|<script\b|__proto__|constructor\s*\()/i;

export function compareSemver(a, b) {
  const pa = String(a).split('-')[0].split('.').map(Number);
  const pb = String(b).split('-')[0].split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    if ((pa[i] || 0) > (pb[i] || 0)) return 1;
    if ((pa[i] || 0) < (pb[i] || 0)) return -1;
  }
  return 0;
}

function isSafeHttpsUrl(val) {
  if (!val) return true;
  try {
    const u = new URL(val);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateAppManifest(manifest = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { valid: false, errors: [{ code: 'INVALID_MANIFEST', message: 'Manifest must be an object' }] };
  }
  if (!SLUG_RE.test(String(manifest.slug || ''))) {
    errors.push({ code: 'INVALID_SLUG', message: 'slug must be 3-61 lowercase alphanumeric/hyphen chars' });
  }
  if (typeof manifest.name !== 'string' || manifest.name.trim().length < 2 || manifest.name.length > 100) {
    errors.push({ code: 'INVALID_NAME', message: 'name must be 2-100 chars' });
  }
  if (!APP_TYPES.includes(manifest.appType)) {
    errors.push({ code: 'INVALID_APP_TYPE', message: `Unsupported appType: ${manifest.appType}` });
  }
  if (!SEMVER_RE.test(String(manifest.version || ''))) {
    errors.push({ code: 'INVALID_VERSION', message: 'version must follow semantic versioning (e.g. 1.0.0)' });
  }
  if (!PRICING_MODELS.includes(manifest.pricingModel || 'free')) {
    errors.push({ code: 'INVALID_PRICING_MODEL', message: 'Unsupported pricingModel' });
  }
  if (manifest.priceCents !== undefined && (!Number.isInteger(manifest.priceCents) || manifest.priceCents < 0)) {
    errors.push({ code: 'INVALID_PRICE_CENTS', message: 'priceCents must be a non-negative integer in minor units' });
  }
  for (const urlField of ['documentationUrl', 'privacyPolicyUrl', 'termsOfServiceUrl', 'supportUrl']) {
    if (manifest[urlField] && !isSafeHttpsUrl(manifest[urlField])) {
      errors.push({ code: 'UNSAFE_URL', field: urlField, message: `${urlField} must be a valid HTTPS URL` });
    }
  }
  const scopes = Array.isArray(manifest.requestedScopes) ? manifest.requestedScopes : [];
  for (const s of scopes) {
    if (!ALLOWED_SCOPES.has(s)) {
      errors.push({ code: 'UNSUPPORTED_SCOPE', scope: s, message: `Scope "${s}" is not in the marketplace scope registry` });
    }
  }
  const serialized = JSON.stringify(manifest);
  if (serialized.length > 100_000) {
    errors.push({ code: 'MANIFEST_TOO_LARGE', message: 'Manifest exceeds 100 KB limit' });
  }
  if (FORBIDDEN_CODE_RE.test(serialized)) {
    errors.push({ code: 'EXECUTABLE_CODE_FORBIDDEN', message: 'Manifest cannot contain executable code or prototype keys' });
  }
  return { valid: errors.length === 0, errors };
}

export function checkUpgradeScopeEscalation({ currentGrantedScopes = [], nextRequestedScopes = [] }) {
  const grantedSet = new Set(currentGrantedScopes);
  const newlyRequested = nextRequestedScopes.filter(s => !grantedSet.has(s));
  return {
    requiresRenewedConsent: newlyRequested.length > 0,
    newlyRequestedScopes: newlyRequested
  };
}

const VALID_APP_TRANSITIONS = new Map([
  ['draft', new Set(['submitted', 'archived'])],
  ['submitted', new Set(['under_review', 'rejected', 'changes_requested'])],
  ['under_review', new Set(['approved', 'changes_requested', 'rejected'])],
  ['changes_requested', new Set(['submitted', 'archived'])],
  ['approved', new Set(['published', 'suspended'])],
  ['published', new Set(['suspended', 'deprecated', 'archived'])],
  ['suspended', new Set(['published', 'removed'])],
  ['rejected', new Set(['draft', 'archived'])]
]);

export function canTransitionAppStatus(fromStatus, toStatus) {
  return Boolean(VALID_APP_TRANSITIONS.get(fromStatus)?.has(toStatus));
}
