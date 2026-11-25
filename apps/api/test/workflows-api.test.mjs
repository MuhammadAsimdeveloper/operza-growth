import test from 'node:test';
import assert from 'node:assert/strict';
import { handleWorkflowsRoutes } from '../routes/workflows.mjs';

function createMockHttpExchange({ method, url, body = null, headers = {} }) {
  const req = {
    method,
    url,
    headers: {
      host: 'localhost:4005',
      ...headers
    }
  };

  let statusCode = 200;
  let responseHeaders = {};
  let responseData = null;

  const res = {
    headersSent: false,
    writeHead(code, headers = {}) {
      statusCode = code;
      responseHeaders = { ...responseHeaders, ...headers };
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) {
        responseData = chunk;
      }
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

test('Workflows API — Comprehensive HTTP contract, validation & execution', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const foreignAgencyId = '99999999-9999-4999-8999-999999999999';

  const state = {
    records: {
      workflows: [],
      contacts: []
    },
    workflowExecutions: [],
    workflowApprovals: []
  };

  let executionTriggered = null;

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'user-1' } },
    agency: { id: agencyId, name: 'Main Agency' },
    activeLocation: { id: locationId, name: 'Primary Location' },
    pgPool: null, // Test in-memory / zero-config mode
    triggerWorkflowExecution: async (payload) => { executionTriggered = payload; },
    executeWorkflowInstance: async (opts) => ({
      id: 'exec-manual-1',
      agencyId: opts.agencyId,
      locationId: opts.locationId,
      workflowId: opts.flow.id,
      status: 'completed',
      steps: []
    }),
    checkTenantUsageLimit: async () => ({ allowed: true }),
    recordTenantUsage: async () => {}
  };

  // 1. Create a workflow via POST /api/crm/workflows
  const createWfEx = createMockHttpExchange({
    method: 'POST',
    url: '/api/crm/workflows',
    body: {
      name: 'Client Onboarding',
      triggerType: 'form',
      triggerConfig: { formId: 'form-123' },
      nodes: [
        { id: 'node_1', type: 'trigger', config: {} },
        { id: 'node_2', type: 'email', config: { subject: 'Welcome' } }
      ]
    }
  });

  const handledCreate = await handleWorkflowsRoutes(createWfEx.req, createWfEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: '/api/crm/workflows',
    readBody: createWfEx.readBody,
    sendJson: createWfEx.sendJson
  });

  assert.equal(handledCreate, true, 'Router must handle POST /api/crm/workflows');
  const createRes = createWfEx.getResult();
  assert.equal(createRes.status, 201);
  assert.ok(createRes.body.id);
  assert.equal(createRes.body.name, 'Client Onboarding');
  assert.equal(createRes.body.agencyId, agencyId);
  assert.equal(createRes.body.locationId, locationId);
  const workflowId = createRes.body.id;

  // 2. List workflows via GET /api/crm/workflows
  const listWfEx = createMockHttpExchange({
    method: 'GET',
    url: '/api/crm/workflows'
  });

  const handledList = await handleWorkflowsRoutes(listWfEx.req, listWfEx.res, {
    ...baseCtx,
    method: 'GET',
    pathname: '/api/crm/workflows',
    readBody: listWfEx.readBody,
    sendJson: listWfEx.sendJson
  });

  assert.equal(handledList, true);
  const listRes = listWfEx.getResult();
  assert.equal(listRes.status, 200);
  const list = listRes.body.data || listRes.body;
  assert.ok(Array.isArray(list));
  assert.equal(list.length, 1);
  assert.equal(list[0].id, workflowId);

  // 3. Update workflow via PUT /api/crm/workflows/:id
  const updateWfEx = createMockHttpExchange({
    method: 'PUT',
    url: `/api/crm/workflows/${workflowId}`,
    body: {
      name: 'Client Onboarding v2',
      status: 'published'
    }
  });

  const handledUpdate = await handleWorkflowsRoutes(updateWfEx.req, updateWfEx.res, {
    ...baseCtx,
    method: 'PUT',
    pathname: `/api/crm/workflows/${workflowId}`,
    readBody: updateWfEx.readBody,
    sendJson: updateWfEx.sendJson
  });

  assert.equal(handledUpdate, true);
  const updateRes = updateWfEx.getResult();
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.body.name, 'Client Onboarding v2');
  assert.equal(updateRes.body.status, 'published');

  // 4. Trigger workflow run via POST /api/workflows/:id/run
  const runWfEx = createMockHttpExchange({
    method: 'POST',
    url: `/api/workflows/${workflowId}/run`,
    body: {
      mode: 'live'
    }
  });

  const handledRun = await handleWorkflowsRoutes(runWfEx.req, runWfEx.res, {
    ...baseCtx,
    method: 'POST',
    pathname: `/api/workflows/${workflowId}/run`,
    readBody: runWfEx.readBody,
    sendJson: runWfEx.sendJson
  });

  assert.equal(handledRun, true);
  const runRes = runWfEx.getResult();
  assert.equal(runRes.status, 201);
  assert.ok(runRes.body.execution);

  // 5. Query workflow runs via GET /api/workflows/runs
  state.workflowExecutions.push({
    id: 'run-1',
    agencyId,
    locationId,
    workflowId,
    status: 'completed',
    createdAt: new Date().toISOString()
  });

  const listRunsEx = createMockHttpExchange({
    method: 'GET',
    url: '/api/workflows/runs'
  });

  const handledRuns = await handleWorkflowsRoutes(listRunsEx.req, listRunsEx.res, {
    ...baseCtx,
    method: 'GET',
    pathname: '/api/workflows/runs',
    readBody: listRunsEx.readBody,
    sendJson: listRunsEx.sendJson
  });

  assert.equal(handledRuns, true);
  const runsRes = listRunsEx.getResult();
  assert.equal(runsRes.status, 200);
  assert.equal(runsRes.body.length, 1);
  assert.equal(runsRes.body[0].id, 'run-1');

  // 6. Delete workflow via DELETE /api/crm/workflows/:id
  const deleteWfEx = createMockHttpExchange({
    method: 'DELETE',
    url: `/api/crm/workflows/${workflowId}`
  });

  const handledDelete = await handleWorkflowsRoutes(deleteWfEx.req, deleteWfEx.res, {
    ...baseCtx,
    method: 'DELETE',
    pathname: `/api/crm/workflows/${workflowId}`,
    readBody: deleteWfEx.readBody,
    sendJson: deleteWfEx.sendJson
  });

  assert.equal(handledDelete, true);
  const deleteRes = deleteWfEx.getResult();
  assert.equal(deleteRes.status, 200);
  assert.equal(deleteRes.body.success, true);
});
