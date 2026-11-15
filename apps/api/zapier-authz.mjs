const SCOPE_RULES = Object.freeze({
  'contacts:read': ['GET:/api/v1/zapier/polls/contact.created', 'GET:/api/v1/zapier/polls/contact.updated'],
  'contacts:write': ['POST:/api/v1/zapier/actions/create_contact', 'POST:/api/v1/zapier/actions/update_contact',
    'POST:/api/v1/zapier/actions/add_tag', 'POST:/api/v1/zapier/actions/remove_tag',
    'POST:/api/v1/zapier/actions/create_note'],
  'opportunities:read': ['POST:/api/v1/zapier/searches/find_opportunity', 'GET:/api/v1/zapier/polls/opportunity.created',
    'GET:/api/v1/zapier/polls/opportunity.stage_changed'],
  'opportunities:write': ['POST:/api/v1/zapier/actions/create_opportunity', 'POST:/api/v1/zapier/actions/update_opportunity'],
  'calendars:read': ['POST:/api/v1/zapier/searches/find_appointment', 'GET:/api/v1/zapier/polls/appointment.booked',
    'GET:/api/v1/zapier/polls/appointment.cancelled'],
  'calendars:write': ['POST:/api/v1/zapier/actions/create_appointment'],
  'tasks:read': ['POST:/api/v1/zapier/searches/find_task', 'GET:/api/v1/zapier/polls/task.created'],
  'tasks:write': ['POST:/api/v1/zapier/actions/create_task'],
  'workflows:execute': ['POST:/api/v1/zapier/actions/trigger_workflow'],
  'communications:dispatch': ['POST:/api/v1/zapier/actions/send_communication'],
  'notifications:read': [],
  'notifications:write': ['POST:/api/v1/zapier/actions/send_notification'],
  'workflows:read': [],
  'payments:read': [],
  'calls:read': [],
  'webhooks:read': ['GET:/api/v1/zapier/hooks', 'GET:/api/v1/zapier/deliveries'],
  'webhooks:manage': ['POST:/api/v1/zapier/hooks/subscribe', 'DELETE:/api/v1/zapier/hooks/unsubscribe',
    'POST:/api/v1/zapier/hooks/test']
});

const PATH_SCOPES = new Map(
  Object.entries(SCOPE_RULES).flatMap(([scope, routes]) => routes.map(route => [route, scope]))
);

function eventScope(event) {
  if (event.startsWith('contact.') || event === 'tag.added') return 'contacts:read';
  if (event.startsWith('opportunity.')) return 'opportunities:read';
  if (event.startsWith('appointment.')) return 'calendars:read';
  if (event.startsWith('task.')) return 'tasks:read';
  if (event.startsWith('notification.')) return 'notifications:read';
  if (event.startsWith('workflow.')) return 'workflows:read';
  if (event.startsWith('payment.') || event.startsWith('invoice.')) return 'payments:read';
  if (event.startsWith('call.')) return 'calls:read';
  return null;
}

export function getZapierRequiredScope(method, pathname) {
  const verb = String(method || 'GET').toUpperCase();
  const path = String(pathname || '').split('?')[0];
  if (verb === 'GET' && (
    path === '/api/v1/zapier/auth/me' ||
    path === '/api/v1/zapier/app-definition' ||
    path === '/api/v1/zapier/schema' ||
    path === '/api/v1/zapier/triggers' ||
    path === '/api/v1/zapier/actions' ||
    path === '/api/v1/zapier/searches'
  )) return null;

  const exact = PATH_SCOPES.get(`${verb}:${path}`);
  if (exact) return exact;
  if (verb === 'DELETE' && /^\\/api\\/v1\\/zapier\\/hooks\\/unsubscribe\\/[^/]+$/.test(path)) return 'webhooks:manage';

  if (verb === 'GET' && path.startsWith('/api/v1/zapier/samples/')) {
    return eventScope(path.slice('/api/v1/zapier/samples/'.length));
  }
  if (verb === 'GET' && path.startsWith('/api/v1/zapier/polls/')) {
    return eventScope(path.slice('/api/v1/zapier/polls/'.length));
  }
  if (verb === 'POST' && path.startsWith('/api/v1/zapier/searches/')) {
    const key = path.slice('/api/v1/zapier/searches/'.length);
    if (key === 'find_contact') return 'contacts:read';
    if (key === 'find_opportunity') return 'opportunities:read';
    if (key === 'find_appointment') return 'calendars:read';
    if (key === 'find_task') return 'tasks:read';
  }
  if (verb === 'POST' && path.startsWith('/api/v1/zapier/actions/')) {
    const key = path.slice('/api/v1/zapier/actions/'.length);
    const actionRoute = `POST:/api/v1/zapier/actions/${key}`;
    return PATH_SCOPES.get(actionRoute) || null;
  }
  return null;
}

export function authorizeZapierRequest({ method, pathname, actor } = {}) {
  if (!actor?.isApiKey) return { allowed: true, requiredScope: null, grantedScopes: [] };
  const scopes = Array.isArray(actor.apiKey?.scopes)
    ? actor.apiKey.scopes.filter(scope => typeof scope === 'string')
    : [];
  const requiredScope = getZapierRequiredScope(method, pathname);
  if (!requiredScope) {
    const path = String(pathname || '').split('?')[0];
    const verb = String(method || 'GET').toUpperCase();
    const publicMetadata = verb === 'GET' && [
      '/api/v1/zapier/auth/me',
      '/api/v1/zapier/app-definition',
      '/api/v1/zapier/schema',
      '/api/v1/zapier/triggers',
      '/api/v1/zapier/actions',
      '/api/v1/zapier/searches'
    ].includes(path);
    return {
      allowed: publicMetadata,
      requiredScope: null,
      grantedScopes: scopes,
      code: publicMetadata ? null : 'UNKNOWN_OR_UNSCOPED_ZAPIER_ROUTE'
    };
  }
  const legacyAlias = requiredScope === 'workflows:execute' ? 'workflows:trigger' : null;
  const allowed = scopes.includes(requiredScope) || Boolean(legacyAlias && scopes.includes(legacyAlias));
  return { allowed, requiredScope, grantedScopes: scopes };
}

export const ZAPIER_SCOPE_CATALOG = Object.freeze(Object.keys(SCOPE_RULES));
