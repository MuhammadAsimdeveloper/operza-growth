import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFormsRoutes } from '../routes/forms.mjs';
import { handleTasksRoutes } from '../routes/tasks.mjs';
import { handleReviewsRoutes } from '../routes/reviews.mjs';
import { handleAgencyRoutes } from '../routes/agency.mjs';

function makeReqRes({ method = 'GET', pathname = '/', body = null } = {}) {
  let statusCode = 0;
  let jsonBody = null;
  const req = { method, url: pathname, headers: { host: 'localhost:3100' } };
  const res = { statusCode: 0 };
  return {
    req,
    res,
    readBody: async () => body || {},
    sendJson: (_res, code, payload) => {
      statusCode = code;
      jsonBody = payload;
    },
    getResult: () => ({ statusCode, jsonBody })
  };
}

function makeCtx(overrides = {}) {
  const state = {
    agencies: [{ id: 'agency-1', name: 'Agency One' }],
    locations: [{ id: 'loc-1', agencyId: 'agency-1', name: 'Main Workspace' }],
    records: {
      contacts: [
        { id: 'c-1', agencyId: 'agency-1', locationId: 'loc-1', firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' }
      ],
      forms: [
        {
          id: 'form-1',
          agencyId: 'agency-1',
          locationId: 'loc-1',
          name: 'Contact Us',
          publicSlug: 'contact-us',
          status: 'published',
          published: true,
          fields: [{ id: 'email', label: 'Email', type: 'email', required: true }],
          submissions: 0
        }
      ],
      formSubmissions: [],
      tasks: [],
      reviews: [],
      reviewRequests: [],
      communicationConsents: [
        {
          id: 'con-1',
          agencyId: 'agency-1',
          locationId: 'loc-1',
          contactId: 'c-1',
          channel: 'sms',
          purpose: 'review_request',
          status: 'revoked',
          source: 'keyword_opt_out',
          capturedAt: '2026-11-25T09:00:00.000Z'
        }
      ],
      team: [
        { id: 'm-owner', agencyId: 'agency-1', email: 'owner@example.com', role: 'owner' },
        { id: 'm-user', agencyId: 'agency-1', email: 'user@example.com', role: 'user' }
      ]
    }
  };

  return {
    state,
    ctx: {
      state,
      saveState: async () => {},
      auditLog: () => {},
      broadcast: () => {},
      actor: {
        user: { id: 'u-1', name: 'Owner', email: 'owner@example.com', role: 'owner' },
        membership: { role: 'owner' }
      },
      agency: { id: 'agency-1', name: 'Agency One' },
      activeLocation: { id: 'loc-1', name: 'Main Workspace' },
      pgPool: null,
      triggerWorkflowExecution: async () => {},
      randomUUID: () => `uuid-${Math.random().toString(36).slice(2, 10)}`,
      randomBytes: n => Buffer.alloc(n, 1),
      getDefaultBranding: () => ({}),
      ...overrides
    }
  };
}

test('Forms API: public submission rejects honeypot, enforces required fields, and derives tenant server-side', async () => {
  const { state, ctx } = makeCtx();

  const botReq = makeReqRes({
    method: 'POST',
    pathname: '/api/forms/submit/contact-us',
    body: { hp: 'spam-bot', answers: { email: 'bot@spam.com' } }
  });
  await handleFormsRoutes(botReq.req, botReq.res, { ...ctx, method: 'POST', pathname: '/api/forms/submit/contact-us', readBody: botReq.readBody, sendJson: botReq.sendJson });
  assert.equal(botReq.getResult().statusCode, 400);

  const missingReq = makeReqRes({
    method: 'POST',
    pathname: '/api/forms/submit/contact-us',
    body: { answers: {} }
  });
  await handleFormsRoutes(missingReq.req, missingReq.res, { ...ctx, method: 'POST', pathname: '/api/forms/submit/contact-us', readBody: missingReq.readBody, sendJson: missingReq.sendJson });
  assert.equal(missingReq.getResult().statusCode, 400);

  const okReq = makeReqRes({
    method: 'POST',
    pathname: '/api/forms/submit/contact-us',
    body: { agencyId: 'attacker-agency', answers: { email: 'lead@example.com', firstName: 'Lead' } }
  });
  await handleFormsRoutes(okReq.req, okReq.res, { ...ctx, method: 'POST', pathname: '/api/forms/submit/contact-us', readBody: okReq.readBody, sendJson: okReq.sendJson });
  assert.equal(okReq.getResult().statusCode, 200);
  assert.equal(state.records.formSubmissions[0].agencyId, 'agency-1');
});

test('Tasks API: strips tenant IDs, enforces API key scopes, and transitions status', async () => {
  const { ctx } = makeCtx();
  const createReq = makeReqRes({
    method: 'POST',
    pathname: '/api/crm/tasks',
    body: { agencyId: 'evil-agency', title: 'Call client', priority: 'high' }
  });
  await handleTasksRoutes(createReq.req, createReq.res, { ...ctx, method: 'POST', pathname: '/api/crm/tasks', readBody: createReq.readBody, sendJson: createReq.sendJson });
  const created = createReq.getResult();
  assert.equal(created.statusCode, 201);
  assert.equal(created.jsonBody.agencyId, 'agency-1');

  const patchReq = makeReqRes({
    method: 'PATCH',
    pathname: `/api/crm/tasks/${created.jsonBody.id}`,
    body: { status: 'completed' }
  });
  await handleTasksRoutes(patchReq.req, patchReq.res, { ...ctx, method: 'PATCH', pathname: `/api/crm/tasks/${created.jsonBody.id}`, readBody: patchReq.readBody, sendJson: patchReq.sendJson });
  assert.equal(patchReq.getResult().statusCode, 200);
  assert.equal(patchReq.getResult().jsonBody.status, 'completed');
});

test('Reviews API: blocks review request when SMS consent is revoked', async () => {
  const { ctx } = makeCtx();
  const reqRes = makeReqRes({
    method: 'POST',
    pathname: '/api/reviews/requests',
    body: { contactId: 'c-1', channel: 'sms', message: 'Leave us a review!', sendNow: true }
  });
  await handleReviewsRoutes(reqRes.req, reqRes.res, { ...ctx, method: 'POST', pathname: '/api/reviews/requests', readBody: reqRes.readBody, sendJson: reqRes.sendJson });
  assert.equal(reqRes.getResult().statusCode, 403);
  assert.equal(reqRes.getResult().jsonBody.code, 'ConsentRevoked');
});

test('Agency API: non-admin member cannot invite team members or escalate roles', async () => {
  const { ctx } = makeCtx({
    actor: {
      user: { id: 'u-2', name: 'Member', email: 'user@example.com', role: 'user' },
      membership: { role: 'user' }
    }
  });

  const inviteReq = makeReqRes({
    method: 'POST',
    pathname: '/api/agency/team/invite',
    body: { name: 'Hacker', email: 'hacker@example.com', role: 'admin' }
  });
  await handleAgencyRoutes(inviteReq.req, inviteReq.res, { ...ctx, method: 'POST', pathname: '/api/agency/team/invite', readBody: inviteReq.readBody, sendJson: inviteReq.sendJson });
  assert.equal(inviteReq.getResult().statusCode, 403);

  const roleReq = makeReqRes({
    method: 'PUT',
    pathname: '/api/agency/team/m-user/role',
    body: { role: 'admin' }
  });
  await handleAgencyRoutes(roleReq.req, roleReq.res, { ...ctx, method: 'PUT', pathname: '/api/agency/team/m-user/role', readBody: roleReq.readBody, sendJson: roleReq.sendJson });
  assert.equal(roleReq.getResult().statusCode, 403);
});
