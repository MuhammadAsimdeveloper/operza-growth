import test from 'node:test';
import assert from 'node:assert/strict';

// Minimal browser globals for testing api.ts and query.ts in Node
globalThis.localStorage = {
  _map: new Map(),
  getItem(k) { return this._map.has(k) ? this._map.get(k) : null; },
  setItem(k, v) { this._map.set(k, String(v)); },
  removeItem(k) { this._map.delete(k); }
};
globalThis.document = { cookie: 'operza_csrf=csrf-token-123' };

test('API client: attaches tenant headers, CSRF on mutations, and parses ApiError', async () => {
  localStorage.setItem('operza_active_location', 'loc-99');
  localStorage.setItem('operza_active_agency', 'ag-77');

  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/fail-401')) {
      return new Response(JSON.stringify({ error: 'Not authenticated', code: 'UNAUTHORIZED' }), { status: 401 });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };

  // Load compiled/TS via dynamic import? Note: Node v24 strips types in .ts when supported or we test logic directly
  // Test ApiError & request semantics cleanly
  const { ApiError, isUnauthorizedError } = await import('../src/lib/api.ts');
  const err401 = new ApiError('Unauthorized', 401, 'UNAUTHORIZED');
  assert.equal(isUnauthorizedError(err401), true);
  assert.equal(isUnauthorizedError(new ApiError('Forbidden', 403)), false);

  const { request } = await import('../src/lib/api.ts');
  await request('/api/crm/tasks', { method: 'POST', body: JSON.stringify({ title: 'Test' }) });
  assert.equal(calls.length, 1);
  const headers = calls[0].init.headers;
  assert.equal(headers.get('x-operza-location'), 'loc-99');
  assert.equal(headers.get('x-operza-agency'), 'ag-77');
  assert.equal(headers.get('x-operza-csrf'), 'csrf-token-123');
  assert.equal(calls[0].init.credentials, 'include');

  await assert.rejects(
    () => request('/api/fail-401'),
    err => isUnauthorizedError(err) && err.code === 'UNAUTHORIZED'
  );
});

test('TanStack Query: tenant-scoped queryKeys isolate agencies and clearTenantCache wipes state', async () => {
  const { queryClient, queryKeys, clearTenantCache } = await import('../src/lib/query.ts');

  const keyA = queryKeys.contacts('agency-a', 'loc-1');
  const keyB = queryKeys.contacts('agency-b', 'loc-1');
  assert.notDeepEqual(keyA, keyB);

  queryClient.setQueryData(keyA, { data: [{ id: 'c1', firstName: 'Alice' }] });
  assert.ok(queryClient.getQueryData(keyA));
  assert.equal(queryClient.getQueryData(keyB), undefined);

  clearTenantCache();
  assert.equal(queryClient.getQueryData(keyA), undefined);
});
