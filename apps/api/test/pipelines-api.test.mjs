import test from 'node:test';
import assert from 'node:assert/strict';
import { handlePipelinesRoutes } from '../routes/pipelines.mjs';

function createMockHttpExchange({ method, url, body = null, headers = {} }) {
  const req = {
    method,
    url,
    headers: { host: 'localhost:4005', ...headers }
  };

  let statusCode = 200;
  let responseData = null;

  const res = {
    headersSent: false,
    writeHead(code) {
      statusCode = code;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) responseData = chunk;
      this.headersSent = true;
    }
  };

  const sendJson = (response, status, payload) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(payload));
  };

  const readBody = async () => body || {};

  return {
    req,
    res,
    sendJson,
    readBody,
    getResult: () => ({
      status: statusCode,
      body: responseData ? JSON.parse(responseData) : null
    })
  };
}

test('Pipelines API — HTTP contract, scope check & tenant isolation', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const foreignAgencyId = '99999999-9999-4999-8999-999999999999';

  const state = {
    records: { pipelines: [] }
  };

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'user-1' } },
    agency: { id: agencyId, name: 'Main Agency' },
    activeLocation: { id: locationId, name: 'Main Location' },
    pgPool: null
  };

  // 1. Create pipeline with spoofed agencyId (must be stripped)
  const createEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/crm/pipelines',
    body: {
      agencyId: foreignAgencyId,
      name: 'Growth Pipeline',
      stages: [{ name: 'Lead' }, { name: 'Won' }]
    }
  });
  const handledCreate = await handlePipelinesRoutes(createEx.req, createEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/crm/pipelines',
    readBody: createEx.readBody,
    sendJson: createEx.sendJson
  });
  assert.equal(handledCreate, true);
  const createRes = createEx.getResult();
  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.agencyId, agencyId, 'Client-supplied agencyId must be stripped');
  assert.equal(createRes.body.stages.length, 2);
  const pipelineId = createRes.body.id;

  // 2. List pipelines
  const listEx = createMockHttpExchange({ method: 'GET', url: '/api/crm/pipelines' });
  await handlePipelinesRoutes(listEx.req, listEx.res, {
    ...baseCtx,
    method: 'GET',
    pathname: '/api/crm/pipelines',
    readBody: listEx.readBody,
    sendJson: listEx.sendJson
  });
  const listRes = listEx.getResult();
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.data.length, 1);

  // 3. Scope check rejection
  const scopedEx = createMockHttpExchange({ method: 'POST', url: '/api/crm/pipelines', body: { name: 'Blocked' } });
  await handlePipelinesRoutes(scopedEx.req, scopedEx.res, {
    ...baseCtx,
    actor: { apiKey: true, scopes: ['contacts:read'] },
    method: 'POST',
    pathname: '/api/crm/pipelines',
    readBody: scopedEx.readBody,
    sendJson: scopedEx.sendJson
  });
  assert.equal(scopedEx.getResult().status, 403);

  // 4. Update & Delete
  const updateEx = createMockHttpExchange({
    method: 'PUT',
    url: `/api/crm/pipelines/${pipelineId}`,
    body: { name: 'Growth Pipeline v2' }
  });
  await handlePipelinesRoutes(updateEx.req, updateEx.res, {
    ...baseCtx,
    method: 'PUT',
    pathname: `/api/crm/pipelines/${pipelineId}`,
    readBody: updateEx.readBody,
    sendJson: updateEx.sendJson
  });
  assert.equal(updateEx.getResult().status, 200);
  assert.equal(updateEx.getResult().body.name, 'Growth Pipeline v2');

  const delEx = createMockHttpExchange({ method: 'DELETE', url: `/api/crm/pipelines/${pipelineId}` });
  await handlePipelinesRoutes(delEx.req, delEx.res, {
    ...baseCtx,
    method: 'DELETE',
    pathname: `/api/crm/pipelines/${pipelineId}`,
    readBody: delEx.readBody,
    sendJson: delEx.sendJson
  });
  assert.equal(delEx.getResult().status, 200);
  assert.equal(delEx.getResult().body.success, true);
});
