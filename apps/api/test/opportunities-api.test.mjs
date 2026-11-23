import test from 'node:test';
import assert from 'node:assert/strict';
import { handleOpportunitiesRoutes } from '../routes/opportunities.mjs';

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

  return { req, res, sendJson, readBody, getResult: () => ({ status: statusCode, body: responseData ? JSON.parse(responseData) : null }) };
}

test('Opportunities API — Comprehensive HTTP contract, validation & tenant isolation', async () => {
  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const foreignAgencyId = '99999999-9999-4999-8999-999999999999';

  const state = {
    records: {
      opportunities: []
    }
  };

  let workflowTriggered = null;
  let zapierEvent = null;

  const baseCtx = {
    state,
    saveState: async () => {},
    auditLog: () => {},
    broadcast: () => {},
    actor: { user: { id: 'user-1' } },
    agency: { id: agencyId },
    activeLocation: { id: locationId },
    triggerWorkflowExecution: async (evt) => { workflowTriggered = evt; },
    dispatchZapierEvent: async (evt) => { zapierEvent = evt; },
    pgPool: null // testing zero-config fallback first
  };

  // 1. Create opportunity with ID injection attempt (should strip agencyId / locationId)
  {
    const exchange = createMockHttpExchange({
      method: 'POST',
      url: '/api/crm/opportunities',
      body: {
        id: 'injected-id',
        agencyId: foreignAgencyId,
        locationId: 'foreign-loc',
        name: 'Big Enterprise Deal',
        value: 75000,
        pipelineId: 'p-1',
        stageId: 'lead',
        stage: 'lead'
      }
    });

    const handled = await handleOpportunitiesRoutes(exchange.req, exchange.res, {
      ...baseCtx,
      pathname: '/api/crm/opportunities',
      method: 'POST',
      readBody: exchange.readBody,
      sendJson: exchange.sendJson
    });

    assert.equal(handled, true);
    const result = exchange.getResult();
    assert.equal(result.status, 201);
    assert.equal(result.body.name, 'Big Enterprise Deal');
    assert.equal(result.body.value, 75000);
    assert.equal(result.body.agencyId, agencyId, 'Agency ID must be forced from session');
    assert.equal(result.body.locationId, locationId, 'Location ID must be forced from session');
  }

  // 2. List opportunities (wire-compatible format with data and pagination)
  {
    const exchange = createMockHttpExchange({
      method: 'GET',
      url: '/api/crm/opportunities?search=Enterprise'
    });

    const handled = await handleOpportunitiesRoutes(exchange.req, exchange.res, {
      ...baseCtx,
      pathname: '/api/crm/opportunities',
      method: 'GET',
      readBody: exchange.readBody,
      sendJson: exchange.sendJson
    });

    assert.equal(handled, true);
    const result = exchange.getResult();
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.data));
    assert.equal(result.body.data.length, 1);
    assert.equal(result.body.pagination.total, 1);
  }

  // 3. Stage move triggers workflow and zapier event
  {
    const created = state.records.opportunities[0];
    const exchange = createMockHttpExchange({
      method: 'PUT',
      url: `/api/crm/opportunities/${created.id}`,
      body: {
        stageId: 'proposal',
        stage: 'proposal',
        status: 'open'
      }
    });

    const handled = await handleOpportunitiesRoutes(exchange.req, exchange.res, {
      ...baseCtx,
      pathname: `/api/crm/opportunities/${created.id}`,
      method: 'PUT',
      readBody: exchange.readBody,
      sendJson: exchange.sendJson
    });

    assert.equal(handled, true);
    const result = exchange.getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.stageId, 'proposal');
    assert.ok(workflowTriggered, 'Stage move must trigger workflow execution');
    assert.equal(workflowTriggered.triggerType, 'opportunity_stage');
  }

  // 4. Cross-tenant isolation negative test
  {
    const created = state.records.opportunities[0];
    const foreignExchange = createMockHttpExchange({
      method: 'GET',
      url: `/api/crm/opportunities/${created.id}`
    });

    const handled = await handleOpportunitiesRoutes(foreignExchange.req, foreignExchange.res, {
      ...baseCtx,
      agency: { id: foreignAgencyId },
      activeLocation: { id: 'loc-other' },
      pathname: `/api/crm/opportunities/${created.id}`,
      method: 'GET',
      readBody: foreignExchange.readBody,
      sendJson: foreignExchange.sendJson
    });

    assert.equal(handled, true);
    const result = foreignExchange.getResult();
    assert.equal(result.status, 404, 'Foreign tenant must receive 404 for existing opportunity');
  }
});
