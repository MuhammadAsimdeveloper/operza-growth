import test from 'node:test';
import assert from 'node:assert/strict';
import { handleConversationsRoutes } from '../routes/conversations.mjs';

function makeReqRes({ method = 'GET', pathname = '/', body = null } = {}) {
  let statusCode = 0;
  let jsonBody = null;
  const req = {
    method,
    url: pathname,
    headers: { host: 'localhost:3100' }
  };
  const res = { statusCode: 0 };
  const sendJson = (_res, code, payload) => {
    statusCode = code;
    jsonBody = payload;
  };
  return {
    req,
    res,
    readBody: async () => body || {},
    sendJson,
    getResult: () => ({ statusCode, jsonBody })
  };
}

function makeBaseCtx(overrides = {}) {
  const state = {
    records: {
      contacts: [
        {
          id: 'contact-1',
          agencyId: 'agency-1',
          locationId: 'loc-1',
          firstName: 'Jane',
          lastName: 'Doe',
          phone: '+15550101',
          email: 'jane@example.com'
        }
      ],
      conversations: [
        {
          id: 'conv-1',
          agencyId: 'agency-1',
          locationId: 'loc-1',
          contactId: 'contact-1',
          contactName: 'Jane Doe',
          channel: 'sms',
          status: 'open',
          messages: [],
          lastMessage: ''
        }
      ],
      communicationConsents: []
    }
  };
  const broadcasts = [];
  const audits = [];

  return {
    state,
    broadcasts,
    audits,
    ctx: {
      state,
      saveState: async () => {},
      auditLog: (action, _actor, meta) => audits.push({ action, meta }),
      broadcast: (event, payload) => broadcasts.push({ event, payload }),
      actor: { user: { id: 'user-1', name: 'Agent Alice', role: 'owner' } },
      agency: { id: 'agency-1' },
      activeLocation: { id: 'loc-1' },
      pgPool: null,
      randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}`,
      ...overrides
    }
  };
}

test('Conversations API: blocks outbound message when contact consent is revoked and never fakes delivered status', async () => {
  const { state, ctx } = makeBaseCtx();

  // Record consent revocation for contact-1 on sms
  const revokeReq = makeReqRes({
    method: 'POST',
    pathname: '/api/platform/consents',
    body: {
      contactId: 'contact-1',
      channel: 'sms',
      purpose: 'transactional',
      status: 'revoked',
      source: 'keyword_opt_out',
      proofRef: 'STOP'
    }
  });
  await handleConversationsRoutes(revokeReq.req, revokeReq.res, {
    ...ctx,
    method: 'POST',
    pathname: '/api/platform/consents',
    readBody: revokeReq.readBody,
    sendJson: revokeReq.sendJson
  });
  assert.equal(revokeReq.getResult().statusCode, 201);

  // Attempt outbound SMS on conv-1 -> must fail with 403 ConsentRevoked
  const sendReq = makeReqRes({
    method: 'POST',
    pathname: '/api/conversations/conv-1/messages',
    body: { content: 'Promo offer', channel: 'sms' }
  });
  await handleConversationsRoutes(sendReq.req, sendReq.res, {
    ...ctx,
    method: 'POST',
    pathname: '/api/conversations/conv-1/messages',
    readBody: sendReq.readBody,
    sendJson: sendReq.sendJson
  });
  assert.equal(sendReq.getResult().statusCode, 403);
  assert.equal(sendReq.getResult().jsonBody.code, 'ConsentRevoked');
  assert.equal(state.records.conversations[0].messages.length, 0);

  // Email to same contact still works and stays queued (not delivered)
  const emailReq = makeReqRes({
    method: 'POST',
    pathname: '/api/conversations/conv-1/messages',
    body: { content: 'Receipt attached', channel: 'email', subject: 'Receipt' }
  });
  await handleConversationsRoutes(emailReq.req, emailReq.res, {
    ...ctx,
    method: 'POST',
    pathname: '/api/conversations/conv-1/messages',
    readBody: emailReq.readBody,
    sendJson: emailReq.sendJson
  });
  const emailRes = emailReq.getResult();
  assert.equal(emailRes.statusCode, 201);
  assert.equal(emailRes.jsonBody.message.deliveryStatus, 'queued');
});

test('Conversations API: enforces API key scopes and strips client-supplied agencyId/locationId', async () => {
  const { ctx } = makeBaseCtx({
    actor: { user: { id: 'user-1', name: 'API Key', role: 'owner' }, apiKey: { id: 'k1' }, scopes: ['contacts:read'] }
  });

  const denied = makeReqRes({ method: 'GET', pathname: '/api/crm/conversations' });
  await handleConversationsRoutes(denied.req, denied.res, {
    ...ctx,
    method: 'GET',
    pathname: '/api/crm/conversations',
    readBody: denied.readBody,
    sendJson: denied.sendJson
  });
  assert.equal(denied.getResult().statusCode, 403);

  const allowedCtx = {
    ...ctx,
    actor: { user: { id: 'user-1', name: 'API Key', role: 'owner' }, apiKey: { id: 'k1' }, scopes: ['conversations:write'] }
  };
  const createReq = makeReqRes({
    method: 'POST',
    pathname: '/api/crm/conversations',
    body: {
      agencyId: 'attacker-agency',
      locationId: 'attacker-loc',
      contactName: 'Bob Smith',
      channel: 'sms'
    }
  });
  await handleConversationsRoutes(createReq.req, createReq.res, {
    ...allowedCtx,
    method: 'POST',
    pathname: '/api/crm/conversations',
    readBody: createReq.readBody,
    sendJson: createReq.sendJson
  });
  const created = createReq.getResult();
  assert.equal(created.statusCode, 201);
  assert.equal(created.jsonBody.agencyId, 'agency-1');
  assert.equal(created.jsonBody.locationId, 'loc-1');
});
