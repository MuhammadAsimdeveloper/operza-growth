import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { handleContactsRoutes } from '../routes/contacts.mjs';

function createMockHttpServer() {
  const state = {
    records: {
      contacts: [],
      opportunities: [],
      tasks: [],
      notes: []
    },
    audit: []
  };

  const agencyA = { id: 'agency-alpha', name: 'Alpha Agency' };
  const locA = { id: 'loc-alpha-1', name: 'Main Location' };
  const actorA = { user: { id: 'user-alpha-1' } };

  const agencyB = { id: 'agency-beta', name: 'Beta Agency' };
  const locB = { id: 'loc-beta-1', name: 'Beta Location' };
  const actorB = { user: { id: 'user-beta-1' } };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method;

    // Simulate auth headers
    const tenantHeader = req.headers['x-tenant'] || 'A';
    const agency = tenantHeader === 'B' ? agencyB : agencyA;
    const activeLocation = tenantHeader === 'B' ? locB : locA;
    const actor = tenantHeader === 'B' ? actorB : actorA;

    const readBody = () => new Promise((resolve) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}); }
        catch { resolve({}); }
      });
    });

    const sendJson = (res, status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const ctx = {
      method,
      pathname,
      url,
      readBody,
      sendJson,
      state,
      saveState: async () => {},
      auditLog: (action, act, details) => {
        state.audit.push({ action, timestamp: new Date().toISOString(), details });
      },
      broadcast: () => {},
      actor,
      agency,
      activeLocation,
      randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2, 9),
      parseCSV: (txt) => [],
      pgPool: null // Tests zero-config local mode contracts
    };

    const handled = await handleContactsRoutes(req, res, ctx);
    if (!handled && !res.headersSent) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return { server, state };
}

function request(server, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const req = http.request({
      hostname: '127.0.0.1',
      port: addr.port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch { json = data; }
        resolve({ status: res.statusCode, headers: res.headers, data: json });
      });
    });
    req.on('error', reject);
    if (body) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

test('Contacts API — Comprehensive HTTP contract and tenant isolation verification', async (t) => {
  const { server, state } = createMockHttpServer();

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  try {
    // 1. Validation error: Missing firstName
    const missingNameRes = await request(server, '/api/crm/contacts', {
      method: 'POST',
      body: { lastName: 'Smith', email: 'smith@test.com' }
    });
    assert.equal(missingNameRes.status, 400);
    assert.ok(missingNameRes.data.error.includes('firstName'));

    // 2. Create contact in Tenant A with attempted ID injection
    const createRes = await request(server, '/api/crm/contacts', {
      method: 'POST',
      headers: { 'x-tenant': 'A' },
      body: {
        id: 'injected-id',
        agencyId: 'injected-agency',
        locationId: 'injected-location',
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@example.com',
        phone: '+15551234567',
        company: 'Acme Corp',
        tags: ['lead']
      }
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.data.firstName, 'John');
    assert.equal(createRes.data.agencyId, 'agency-alpha');
    assert.equal(createRes.data.locationId, 'loc-alpha-1');
    const contactAId = createRes.data.id;

    // 3. Retrieve contact by ID in Tenant A
    const getRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'GET',
      headers: { 'x-tenant': 'A' }
    });
    assert.equal(getRes.status, 200);
    assert.equal(getRes.data.id, contactAId);
    assert.equal(getRes.data.email, 'john.doe@example.com');

    // 4. Cross-tenant negative test: Tenant B cannot retrieve Tenant A contact
    const crossGetRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'GET',
      headers: { 'x-tenant': 'B' }
    });
    assert.equal(crossGetRes.status, 404);

    // 5. Update contact in Tenant A
    const updateRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'PUT',
      headers: { 'x-tenant': 'A' },
      body: {
        status: 'customer',
        company: 'Acme International'
      }
    });
    assert.equal(updateRes.status, 200);
    assert.equal(updateRes.data.status, 'customer');
    assert.equal(updateRes.data.company, 'Acme International');

    // 6. Cross-tenant update rejection: Tenant B cannot update Tenant A contact
    const crossUpdateRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'PUT',
      headers: { 'x-tenant': 'B' },
      body: { company: 'Hacked Corp' }
    });
    assert.equal(crossUpdateRes.status, 404);

    // 7. Bulk tag in Tenant A
    const bulkTagRes = await request(server, '/api/crm/contacts/bulk-tag', {
      method: 'POST',
      headers: { 'x-tenant': 'A' },
      body: { contactIds: [contactAId], tag: 'q4-accelerator' }
    });
    assert.equal(bulkTagRes.status, 200);
    assert.equal(bulkTagRes.data.success, true);
    assert.equal(bulkTagRes.data.updated, 1);

    // 8. Client portal access toggle
    const portalRes = await request(server, `/api/crm/contacts/${contactAId}/portal-access`, {
      method: 'PUT',
      headers: { 'x-tenant': 'A' },
      body: { portalAccess: true }
    });
    assert.equal(portalRes.status, 200);
    assert.equal(portalRes.data.portalAccess, true);

    // 9. Activity timeline
    const timelineRes = await request(server, `/api/crm/contacts/${contactAId}/timeline`, {
      method: 'GET',
      headers: { 'x-tenant': 'A' }
    });
    assert.equal(timelineRes.status, 200);
    assert.equal(timelineRes.data.contactId, contactAId);
    assert.ok(Array.isArray(timelineRes.data.timeline));
    assert.ok(timelineRes.data.timeline.length >= 1);

    // 10. List contacts with search filter
    const listRes = await request(server, '/api/crm/contacts?search=John', {
      method: 'GET',
      headers: { 'x-tenant': 'A' }
    });
    assert.equal(listRes.status, 200);
    assert.equal(listRes.data.data.length, 1);
    assert.equal(listRes.data.data[0].id, contactAId);

    // 11. Delete contact in Tenant A
    const deleteRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'DELETE',
      headers: { 'x-tenant': 'A' }
    });
    assert.equal(deleteRes.status, 200);
    assert.equal(deleteRes.data.success, true);

    // 12. Verify deleted returns 404
    const verifyDelRes = await request(server, `/api/crm/contacts/${contactAId}`, {
      method: 'GET',
      headers: { 'x-tenant': 'A' }
    });
    assert.equal(verifyDelRes.status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
