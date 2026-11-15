import {
  createOutlookCalendarEvent,
  getMicrosoftProfile,
  refreshMicrosoftAccessToken,
  sendOutlookMail
} from './microsoft-graph.mjs';

/**
 * Tenant-delegated Microsoft Graph email/calendar adapter.
 *
 * The refresh token is supplied only by Operza's server-side secret resolver.
 * It is never returned to callers or included in verification receipts.
 */
export function createMicrosoftGraphEmailAdapter({
  clientId = process.env.MICROSOFT_GRAPH_CLIENT_ID || process.env.MICROSOFT_CALENDAR_CLIENT_ID,
  clientSecret = process.env.MICROSOFT_GRAPH_CLIENT_SECRET || process.env.MICROSOFT_CALENDAR_CLIENT_SECRET,
  tenant = process.env.MICROSOFT_GRAPH_TENANT || 'common',
  secretResolver = null,
  fetchFn = globalThis.fetch
} = {}) {
  async function obtainAccessToken(secret, secretRef) {
    const tokens = await refreshMicrosoftAccessToken({
      clientId,
      clientSecret,
      refreshToken: secret,
      tenant,
      fetchFn
    });
    if (
      tokens.refreshToken &&
      tokens.refreshToken !== secret &&
      secretRef &&
      typeof secretResolver?.store === 'function'
    ) {
      await secretResolver.store(secretRef, tokens.refreshToken);
    }
    return tokens.accessToken;
  }

  return Object.freeze({
    id: 'adapter-microsoft-graph-email-v1',
    providerKey: 'email.microsoft_graph',
    channel: 'email',

    async verify({ secret, config = {}, secretRef } = {}) {
      if (!clientId || !clientSecret) {
        return { verified: false, error: 'Microsoft Graph OAuth client is not configured on this server' };
      }
      if (typeof secret !== 'string' || secret.length < 8) {
        return { verified: false, error: 'Microsoft Graph refresh token is missing or invalid' };
      }
      try {
        const accessToken = await obtainAccessToken(secret, secretRef);
        const profile = await getMicrosoftProfile({ accessToken, fetchFn });
        const accountId = typeof profile.id === 'string' ? profile.id : config.accountId;
        if (!accountId) return { verified: false, error: 'Microsoft Graph profile did not include an account ID' };
        return {
          verified: true,
          accountId,
          senderEmail: profile.mail || profile.userPrincipalName || config.senderEmail || '',
          senderName: profile.displayName || config.senderName || ''
        };
      } catch {
        return { verified: false, error: 'Microsoft Graph mailbox verification failed' };
      }
    },

    async dispatch({ secret, secretRef, payload = {}, consent, action = 'send_email' } = {}) {
      if (!consent || consent.status !== 'granted') {
        return { ok: false, error: 'Communication consent not granted', code: 'CONSENT_REQUIRED' };
      }
      if (!clientId || !clientSecret) {
        return { ok: false, error: 'Microsoft Graph OAuth client is not configured', code: 'PROVIDER_NOT_CONFIGURED' };
      }
      try {
        const accessToken = await obtainAccessToken(secret, secretRef);
        if (action === 'create_calendar_event') {
          const event = await createOutlookCalendarEvent({
            accessToken,
            subject: payload.subject,
            start: payload.start,
            end: payload.end,
            body: payload.body,
            attendees: payload.attendees,
            location: payload.location,
            fetchFn
          });
          return {
            ok: true,
            provider: 'microsoft_graph',
            eventId: event.id || null,
            statusCode: event.statusCode || 201,
            accepted: true,
            delivered: false
          };
        }

        const result = await sendOutlookMail({
          accessToken,
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          contentType: payload.contentType || 'Text',
          fetchFn
        });
        return {
          ok: result.accepted,
          provider: 'microsoft_graph',
          statusCode: result.statusCode,
          accepted: result.accepted,
          delivered: false,
          error: result.accepted ? undefined : 'Microsoft Graph did not accept the message'
        };
      } catch {
        return {
          ok: false,
          provider: 'microsoft_graph',
          code: 'MICROSOFT_GRAPH_DISPATCH_FAILED',
          error: 'Microsoft Graph could not process the requested action'
        };
      }
    }
  });
}
