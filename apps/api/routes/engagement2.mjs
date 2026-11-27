import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createEngagement2Repository } from '../../../packages/db/lib/engagement-2-repository.mjs';
import {
  generateAiInboxSuggestion,
  validateTemplate,
  renderSafeTemplate,
  evaluateRecipientEligibility
} from '../../../packages/platform-core/src/engagement-2-0.mjs';

const repo = createEngagement2Repository();

export async function handleEngagement2Routes({ req, res, pathname, method, ctx }) {
  if (!pathname.startsWith('/api/engagement/v2')) return false;

  const { pgPool, agency, activeLocation, actor, readBody, sendJson } = ctx;
  if (!agency || !activeLocation) {
    sendJson(res, 401, { error: 'Authentication required' });
    return true;
  }

  // Stateless AI Response Assistant & Template Preview work in both PG and JSON modes
  if (method === 'POST' && pathname === '/api/engagement/v2/inbox/ai-assist') {
    const body = await readBody(req);
    const suggestion = generateAiInboxSuggestion({
      messages: Array.isArray(body.messages) ? body.messages : [],
      contact: body.contact || null,
      kbSnippets: Array.isArray(body.kbSnippets) ? body.kbSnippets : [],
      autoSendPolicyEnabled: body.autoSendPolicyEnabled === true
    });
    sendJson(res, 200, suggestion);
    return true;
  }

  if (method === 'POST' && pathname === '/api/engagement/v2/templates/preview') {
    const body = await readBody(req);
    const check = validateTemplate({
      channel: body.channel || 'email',
      body: body.body || '',
      approvalStatus: body.approvalStatus || 'draft',
      providerTemplateId: body.providerTemplateId || null
    });
    if (!check.valid) {
      sendJson(res, 400, { error: check.error, code: check.code });
      return true;
    }
    const rendered = renderSafeTemplate({
      channel: body.channel || 'email',
      body: body.body || '',
      context: body.context || {}
    });
    sendJson(res, 200, { valid: true, variables: check.variables, rendered });
    return true;
  }

  if (method === 'POST' && pathname === '/api/engagement/v2/eligibility/check') {
    const body = await readBody(req);
    const result = evaluateRecipientEligibility({
      contact: body.contact,
      channel: body.channel || 'sms',
      purpose: body.purpose || 'marketing',
      suppressions: Array.isArray(body.suppressions) ? body.suppressions : [],
      consents: Array.isArray(body.consents) ? body.consents : [],
      recentSendCount: Number(body.recentSendCount || 0),
      timezone: body.timezone || 'UTC'
    });
    sendJson(res, 200, result);
    return true;
  }

  if (!pgPool) {
    sendJson(res, 503, { error: 'PostgreSQL is required for Engagement 2.0 persistence', code: 'DATABASE_UNAVAILABLE' });
    return true;
  }

  const tenantCtx = {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.id || actor?.userId || 'system'
  };

  try {
    if (method === 'GET' && pathname === '/api/engagement/v2/templates') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listTemplates(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/engagement/v2/templates') {
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.createTemplate(tx, body));
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'GET' && pathname === '/api/engagement/v2/campaigns') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listCampaigns(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/engagement/v2/campaigns') {
      const body = await readBody(req);
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.createCampaign(tx, body));
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'POST' && pathname.startsWith('/api/engagement/v2/campaigns/') && pathname.endsWith('/transition')) {
      const campaignId = pathname.split('/')[5];
      const body = await readBody(req);
      const updated = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.transitionCampaignStatus(tx, { campaignId, toStatus: body.status, actorId: tenantCtx.actorId })
      );
      if (!updated) {
        sendJson(res, 404, { error: 'Campaign not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
    if (method === 'GET' && pathname === '/api/engagement/v2/suppressions') {
      const data = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.listSuppressions(tx));
      sendJson(res, 200, { data });
      return true;
    }
    if (method === 'POST' && pathname === '/api/engagement/v2/suppressions') {
      const body = await readBody(req);
      if (!body.identifier) {
        sendJson(res, 400, { error: 'identifier is required' });
        return true;
      }
      const created = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.addSuppression(tx, body));
      sendJson(res, 201, created);
      return true;
    }
    if (method === 'POST' && pathname.startsWith('/api/engagement/v2/conversations/') && pathname.endsWith('/notes')) {
      const conversationId = pathname.split('/')[5];
      const body = await readBody(req);
      const note = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.addConversationNote(tx, {
          conversationId,
          authorId: tenantCtx.actorId,
          authorName: actor?.name || 'Agent',
          body: body.body || ''
        })
      );
      sendJson(res, 201, note);
      return true;
    }
    if (method === 'PATCH' && pathname.startsWith('/api/engagement/v2/conversations/')) {
      const conversationId = pathname.split('/')[5];
      const body = await readBody(req);
      const updated = await runInTenantTx(pgPool, tenantCtx, (tx) =>
        repo.updateConversationMeta(tx, {
          conversationId,
          status: body.status,
          priority: body.priority,
          assignedTo: body.assignedTo,
          actorId: tenantCtx.actorId
        })
      );
      if (!updated) {
        sendJson(res, 404, { error: 'Conversation not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
    if (method === 'POST' && pathname === '/api/engagement/v2/journeys/enroll') {
      const body = await readBody(req);
      const enrolled = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.enrollJourney(tx, body));
      sendJson(res, enrolled.enrolled ? 201 : 200, enrolled);
      return true;
    }
    if (method === 'GET' && pathname === '/api/engagement/v2/analytics') {
      const summary = await runInTenantTx(pgPool, tenantCtx, (tx) => repo.getEngagementAnalytics(tx));
      sendJson(res, 200, summary);
      return true;
    }
    sendJson(res, 404, { error: 'Engagement 2.0 endpoint not found' });
    return true;
  } catch (err) {
    const code = err?.code || 'ENGAGEMENT_ERROR';
    const status = ['INVALID_CAMPAIGN_TRANSITION', 'INVALID_CONVERSATION_TRANSITION', 'UNSAFE_TEMPLATE_CONTENT', 'UNKNOWN_TEMPLATE_VARIABLE', 'WHATSAPP_PROVIDER_APPROVAL_REQUIRED'].includes(code) ? 400 : 500;
    sendJson(res, status, { error: err.message, code });
    return true;
  }
}
