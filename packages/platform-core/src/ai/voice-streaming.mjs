/**
 * Phase 5 — Streaming Voice AI Session Manager
 * Supports short-lived HMAC-signed session tokens (never exposes provider keys),
 * consent enforcement, incremental streaming turns, barge-in interruption,
 * cancellation, and voice duration/token metering.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export function createVoiceAiSessionManager({
  costGovernance,
  signingSecret = process.env.VOICE_SESSION_SIGNING_SECRET || randomUUID(),
  defaultTtlSeconds = 300
} = {}) {
  const sessions = new Map();

  function signToken(sessionId, agencyId, locationId, expiresAtMs) {
    const payload = `${sessionId}.${agencyId}.${locationId}.${expiresAtMs}`;
    const sig = createHmac('sha256', signingSecret).update(payload).digest('hex');
    return `${payload}.${sig}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 5) return null;
    const [sessionId, agencyId, locationId, expStr, sig] = parts;
    const expectedSig = createHmac('sha256', signingSecret)
      .update(`${sessionId}.${agencyId}.${locationId}.${expStr}`)
      .digest('hex');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return { sessionId, agencyId, locationId, expiresAtMs: Number(expStr) };
  }

  function issueSession({
    agencyId,
    locationId,
    userId = null,
    contactId = null,
    provider = 'twilio_media_streams',
    consentVerified = false,
    recordingPermitted = false,
    transcriptionPermitted = false,
    ttlSeconds = defaultTtlSeconds,
    now = Date.now()
  } = {}) {
    if (!agencyId || !locationId) {
      throw Object.assign(new TypeError('Tenant context required for voice session'), { code: 'TENANT_CONTEXT_REQUIRED' });
    }
    if (consentVerified !== true) {
      throw Object.assign(new Error('Communication consent is required before starting a Voice AI session'), {
        code: 'VOICE_CONSENT_REQUIRED'
      });
    }

    const id = randomUUID();
    const expiresAtMs = now + Math.min(900, Math.max(30, ttlSeconds)) * 1000;
    const token = signToken(id, agencyId, locationId, expiresAtMs);
    const session = {
      id,
      agencyId,
      locationId,
      userId,
      contactId,
      provider,
      status: 'authorized',
      consentVerified: true,
      recordingPermitted: Boolean(recordingPermitted),
      transcriptionPermitted: Boolean(transcriptionPermitted),
      interrupted: false,
      cancelled: false,
      durationSeconds: 0,
      inputTokens: 0,
      outputTokens: 0,
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs
    };
    sessions.set(id, session);
    return { session, sessionToken: token };
  }

  function interruptSession(sessionId, reason = 'barge_in') {
    const s = sessions.get(sessionId);
    if (!s) return null;
    s.interrupted = true;
    s.status = 'interrupted';
    s.interruptReason = reason;
    return s;
  }

  function cancelSession(sessionId) {
    const s = sessions.get(sessionId);
    if (!s) return null;
    s.cancelled = true;
    s.status = 'cancelled';
    s.endedAt = new Date().toISOString();
    return s;
  }

  async function* streamTurn({
    sessionToken,
    audioFrames = [],
    responder = null,
    now = Date.now()
  } = {}) {
    const claims = verifyToken(sessionToken);
    if (!claims) {
      throw Object.assign(new Error('Invalid voice session token'), { code: 'VOICE_TOKEN_INVALID' });
    }
    if (now > claims.expiresAtMs) {
      throw Object.assign(new Error('Voice session token expired'), { code: 'VOICE_TOKEN_EXPIRED' });
    }
    const session = sessions.get(claims.sessionId);
    if (!session || session.cancelled) {
      throw Object.assign(new Error('Voice session is closed or cancelled'), { code: 'VOICE_SESSION_CLOSED' });
    }

    if (session.interrupted) {
      yield {
        type: 'interrupted',
        sessionId: session.id,
        reason: session.interruptReason || 'barge_in'
      };
      return;
    }

    session.status = 'streaming';

    const transcriptParts = [];
    for (const frame of audioFrames) {
      if (session.cancelled || session.interrupted) {
        yield {
          type: session.cancelled ? 'cancelled' : 'interrupted',
          sessionId: session.id
        };
        return;
      }
      const text = String(frame?.transcript || '').trim();
      if (text) {
        transcriptParts.push(text);
        yield { type: 'stt_partial', text, sessionId: session.id };
      }
      session.durationSeconds += Number(frame?.durationSeconds || 1);
    }

    const fullTranscript = transcriptParts.join(' ').trim();
    const reply = typeof responder === 'function'
      ? await responder(fullTranscript, session)
      : `Acknowledged: ${fullTranscript}`;

    const words = String(reply || '').split(/\s+/).filter(Boolean);
    for (const word of words) {
      if (session.cancelled || session.interrupted) {
        yield {
          type: session.cancelled ? 'cancelled' : 'interrupted',
          sessionId: session.id
        };
        return;
      }
      yield { type: 'tts_chunk', text: `${word} `, sessionId: session.id };
      session.outputTokens += 1;
    }

    session.inputTokens += Math.max(1, transcriptParts.length * 4);
    session.status = 'ended';
    session.endedAt = new Date().toISOString();

    if (costGovernance) {
      costGovernance.recordUsage({
        agencyId: session.agencyId,
        locationId: session.locationId,
        userId: session.userId,
        provider: session.provider,
        model: 'voice-stream-v1',
        requestType: 'voice',
        inputTokens: session.inputTokens,
        outputTokens: session.outputTokens,
        voiceSeconds: session.durationSeconds,
        estimatedCostMicrocents: session.durationSeconds * 2500
      });
    }

    yield {
      type: 'done',
      sessionId: session.id,
      durationSeconds: session.durationSeconds,
      inputTokens: session.inputTokens,
      outputTokens: session.outputTokens
    };
  }

  return {
    issueSession,
    interruptSession,
    cancelSession,
    streamTurn,
    getSession: (id) => sessions.get(id) || null
  };
}
