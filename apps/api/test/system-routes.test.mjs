import test from 'node:test';
import assert from 'node:assert/strict';
import { handleSystemRoutes } from '../routes/system.mjs';

function makeContext(overrides = {}) {
  let statusCode = 0;
  let body = null;
  const res = {
    writeHead(status) { statusCode = status; },
    end(raw) { body = typeof raw === 'string' ? JSON.parse(raw) : raw; }
  };
  const ctx = {
    pathname: '/ready',
    method: 'GET',
    sendJson(response, status, payload) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(payload));
      return true;
    },
    readBody: async () => ({}),
    state: { records: {}, users: [], agencies: [], locations: [] },
    pgPool: null,
    platformRepository: null,
    platformDbEnabled: false,
    isStagingOrProd: false,
    secretVaultDurable: false,
    wss: null,
    wsClients: new Set(),
    workflowQueue: { getMetrics: () => ({}) },
    memoryOutboxRepo: { getStats: () => ({}) },
    trustedWorkerHandlers: {},
    executeWorkerTick: async () => ({}),
    randomUUID: () => '00000000-0000-4000-8000-000000000001',
    getActor: () => null,
    ...overrides
  };
  return { ctx, res, get statusCode() { return statusCode; }, get body() { return body; } };
}

test('local development readiness clearly reports JSON-file mode', async () => {
  const fixture = makeContext();
  assert.equal(await handleSystemRoutes({}, fixture.res, fixture.ctx), true);
  assert.equal(fixture.statusCode, 200);
  assert.equal(fixture.body.ready, true);
  assert.equal(fixture.body.dbEngine, 'json_file');
  assert.equal(fixture.body.secretVault, 'ephemeral_or_unconfigured');
});

test('production readiness fails when PostgreSQL platform mode is disabled', async () => {
  const fixture = makeContext({ isStagingOrProd: true });
  await handleSystemRoutes({}, fixture.res, fixture.ctx);
  assert.equal(fixture.statusCode, 503);
  assert.equal(fixture.body.ready, false);
  assert.equal(fixture.body.platformStatus, 'disabled');
});

test('production readiness fails when platform migrations or RLS are not ready', async () => {
  const fixture = makeContext({
    isStagingOrProd: true,
    platformDbEnabled: true,
    secretVaultDurable: true,
    pgPool: { async query() { return { rows: [{ ok: 1 }] }; } },
    platformRepository: {
      async checkReady() { throw Object.assign(new Error('RLS not ready'), { code: 'PLATFORM_RLS_INCOMPLETE' }); }
    }
  });
  await handleSystemRoutes({}, fixture.res, fixture.ctx);
  assert.equal(fixture.statusCode, 503);
  assert.equal(fixture.body.ready, false);
  assert.equal(fixture.body.platformStatus, 'not_ready');
  assert.equal(fixture.body.platformError, 'PLATFORM_RLS_INCOMPLETE');
});

test('admin telemetry routes require an authenticated workspace administrator', async () => {
  const unauthenticated = makeContext({ pathname: '/api/admin/queue/status' });
  await handleSystemRoutes({}, unauthenticated.res, unauthenticated.ctx);
  assert.equal(unauthenticated.statusCode, 401);

  const viewer = makeContext({
    pathname: '/api/admin/queue/status',
    getActor: () => ({ user: { id: 'user_001' }, membership: { role: 'viewer' } })
  });
  await handleSystemRoutes({}, viewer.res, viewer.ctx);
  assert.equal(viewer.statusCode, 403);
});

test('public metrics do not expose tenant CRM record counts or account totals', async () => {
  const fixture = makeContext({
    pathname: '/metrics',
    state: {
      records: { contacts: [{ email: 'private@example.com' }] },
      users: [{ id: 'user_001' }],
      agencies: [{ id: 'agency_001' }],
      locations: [{ id: 'location_001' }]
    }
  });
  await handleSystemRoutes({}, fixture.res, fixture.ctx);
  assert.equal(fixture.statusCode, 200);
  assert.equal('records' in fixture.body.database, false);
  assert.equal('totalUsers' in fixture.body.database, false);
  assert.equal('totalAgencies' in fixture.body.database, false);
});
