/**
 * Phase 5 — Modular AI Platform API Routes
 * Exposes honest provider status, AI usage/budget governance, tool registry metadata,
 * evaluation summary, and Voice AI short-lived session issuance.
 */

export function createAiPlatformRoutes({
  providerGateway,
  costGovernance,
  toolRegistry,
  voiceManager,
  sendJson,
  readBody,
  auditLog
} = {}) {
  return async function handleAiPlatformRoute({ method, pathname, req, res, agency, activeLocation, actor }) {
    const agencyId = agency?.id;
    const locationId = activeLocation?.id || 'default';

    if (method === 'GET' && pathname === '/api/ai/providers') {
      return sendJson(res, 200, {
        providers: providerGateway.listProviders(),
        models: providerGateway.listModels()
      });
    }

    if (method === 'GET' && pathname === '/api/ai/usage') {
      return sendJson(res, 200, {
        usage: costGovernance.getUsageSummary({ agencyId, locationId })
      });
    }

    if (method === 'GET' && pathname === '/api/ai/tools') {
      return sendJson(res, 200, {
        tools: toolRegistry.listTools()
      });
    }

    if (method === 'POST' && pathname === '/api/ai/voice/sessions') {
      const body = await readBody(req);
      try {
        const issued = voiceManager.issueSession({
          agencyId,
          locationId,
          userId: actor?.user?.id || actor?.id || 'unknown',
          contactId: body?.contactId || null,
          consentVerified: Boolean(body?.consentVerified),
          recordingPermitted: Boolean(body?.recordingPermitted),
          transcriptionPermitted: Boolean(body?.transcriptionPermitted),
          ttlSeconds: Number(body?.ttlSeconds || 300)
        });
        auditLog?.('ai.voice_session_issued', actor, { sessionId: issued.session.id });
        return sendJson(res, 201, {
          session: issued.session,
          sessionToken: issued.sessionToken
        });
      } catch (err) {
        const status = err?.code === 'VOICE_CONSENT_REQUIRED' ? 403 : 400;
        return sendJson(res, status, { error: err.message, code: err.code || 'VOICE_SESSION_ERROR' });
      }
    }

    return false;
  };
}
