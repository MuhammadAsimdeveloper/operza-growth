/**
 * ============================================================================
 * Operza Reviews & Reputation Router — TenantTx Boundary
 * ============================================================================
 */

import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createReviewsRepository } from '../../../packages/db/lib/reviews-repository.mjs';
import { createCommunicationConsentsRepository } from '../../../packages/db/lib/communication-consents-repository.mjs';

const reviewsRepo = createReviewsRepository();
const consentsRepo = createCommunicationConsentsRepository();

function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

function stripTenantFields(body) {
  if (!body || typeof body !== 'object') return {};
  const { agencyId: _a, locationId: _l, ...rest } = body;
  return rest;
}

function checkInMemoryConsent(state, { agencyId, locationId, contactId, channel }) {
  if (!contactId || !['email', 'sms', 'whatsapp'].includes(channel)) {
    return { allowed: true };
  }
  const records = [
    ...(state.records?.communicationConsents || []),
    ...(state.communicationConsents || [])
  ]
    .filter(c => (c.agencyId === agencyId || c.tenantId === agencyId) && c.locationId === locationId && c.contactId === contactId && c.channel === channel)
    .sort((a, b) => String(b.capturedAt || b.createdAt || '').localeCompare(String(a.capturedAt || a.createdAt || '')));

  if (records.length > 0 && records[0].status === 'revoked') {
    return { allowed: false, reason: 'consent_revoked' };
  }
  return { allowed: true };
}

export async function handleReviewsRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    readBody,
    sendJson,
    state,
    saveState,
    auditLog,
    broadcast,
    actor,
    agency,
    activeLocation,
    pgPool,
    triggerWorkflowExecution,
    randomUUID
  } = ctx;

  // ── 1. Public Review Lookup ───────────────────────────────────────────────
  if (method === 'GET' && pathname.startsWith('/api/reviews/public/')) {
    const locationId = pathname.replace('/api/reviews/public/', '').trim();
    const loc = (state.locations || []).find(l => l.id === locationId) || state.locations?.[0];
    const ag = loc ? (state.agencies || []).find(a => a.id === loc.agencyId) : state.agencies?.[0];
    sendJson(res, 200, {
      locationId: loc?.id || 'main',
      locationName: loc?.name || 'Main Workspace',
      agencyName: ag?.name || 'Operza Agency',
      prompt: 'How was your recent experience with our team?'
    });
    return true;
  }

  // ── 2. Public Review Submission Ingress ───────────────────────────────────
  if (method === 'POST' && pathname.startsWith('/api/reviews/submit/')) {
    const locationId = pathname.replace('/api/reviews/submit/', '').trim();
    const loc = (state.locations || []).find(l => l.id === locationId) || state.locations?.[0];
    const agencyId = loc?.agencyId || state.agencies?.[0]?.id;

    const body = await readBody(req);
    const { contactName, email, rating, text, source } = body;
    const numRating = Math.max(1, Math.min(5, Number(rating) || 5));

    const reviewId = randomUUID();
    const review = {
      id: reviewId,
      agencyId,
      locationId: loc?.id || 'main',
      contactName: contactName || 'Verified Client',
      email: email || '',
      rating: numRating,
      text: String(text || '').slice(0, 5000),
      source: source || 'Direct Client Portal',
      status: 'new',
      receivedAt: new Date().toISOString(),
      createdAt: new Date().toISOString()
    };
    state.records.reviews = state.records.reviews || [];
    state.records.reviews.push(review);

    let contact = null;
    if (email) {
      contact = (state.records.contacts || []).find(
        c => c.agencyId === agencyId && c.email === String(email).toLowerCase().trim()
      );
    }
    if (!contact && contactName) {
      contact = (state.records.contacts || []).find(
        c => c.agencyId === agencyId && `${c.firstName} ${c.lastName}`.trim().toLowerCase() === String(contactName).trim().toLowerCase()
      );
    }

    if (contact) {
      contact.tags = contact.tags || [];
      if (numRating >= 4) {
        if (!contact.tags.includes('promoter')) contact.tags.push('promoter');
      } else {
        if (!contact.tags.includes('detractor')) contact.tags.push('detractor');
        const taskId = randomUUID();
        state.records.tasks = state.records.tasks || [];
        state.records.tasks.push({
          id: taskId,
          agencyId,
          locationId: loc?.id || 'main',
          title: `Urgent: Reach out to ${contact.firstName} ${contact.lastName} regarding ${numRating}-star review`,
          contactId: contact.id,
          priority: 'high',
          status: 'pending',
          notes: review.text,
          createdAt: new Date().toISOString()
        });
        broadcast?.('crm.task.created', { id: taskId, title: `Review resolution for ${contact.firstName}` });
      }
    }

    await saveState();
    broadcast?.('crm.review.created', { id: reviewId, rating: numRating, contactName: review.contactName });

    if (typeof triggerWorkflowExecution === 'function') {
      triggerWorkflowExecution({
        agencyId,
        locationId: loc?.id || 'main',
        triggerType: 'review',
        triggerContext: { review, contact, rating: numRating }
      }).catch(err => console.error('Review workflow trigger failed:', err));
    }

    sendJson(res, 201, {
      success: true,
      message: 'Thank you for your review!',
      review
    });
    return true;
  }

  const agencyId = agency?.id;
  const locationId = activeLocation?.id;
  const actorId = actor?.user?.id || 'system';

  // ── 3. Review Requests (with consent check) ───────────────────────────────
  if (method === 'POST' && (pathname === '/api/reviews/requests' || pathname === '/api/reviews/request')) {
    if (!checkScope(actor, 'reviews:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (reviews:write required)' });
      return true;
    }
    const body = stripTenantFields(await readBody(req));
    const { contactId, channel = 'email', message = '', scheduledAt, sendNow } = body;
    if (!contactId) {
      sendJson(res, 400, { error: 'contactId is required' });
      return true;
    }

    if (pgPool) {
      const result = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, async tx => {
        const consentCheck = await consentsRepo.isChannelAllowed(tx, {
          agencyId,
          locationId,
          contactId,
          channel,
          purpose: 'review_request'
        });
        if (!consentCheck.allowed) {
          return { blocked: true, consentCheck };
        }
        const request = await reviewsRepo.createReviewRequest(tx, {
          agencyId,
          locationId,
          contactId,
          channel,
          message,
          scheduledAt,
          status: sendNow ? 'sent' : 'scheduled'
        });
        return { request };
      });
      if (result.blocked) {
        sendJson(res, 403, {
          error: `Review request blocked by communication consent (${result.consentCheck.reason})`,
          code: 'ConsentRevoked'
        });
        return true;
      }
      auditLog?.('review.requested', actor, { requestId: result.request.id, contactId, channel });
      broadcast?.('review.requested', { request: result.request });
      sendJson(res, 201, { success: true, request: result.request });
      return true;
    }

    const consentCheck = checkInMemoryConsent(state, { agencyId, locationId, contactId, channel });
    if (!consentCheck.allowed) {
      sendJson(res, 403, {
        error: `Review request blocked by communication consent (${consentCheck.reason})`,
        code: 'ConsentRevoked'
      });
      return true;
    }

    const reqId = randomUUID();
    const isSendNow = Boolean(sendNow);
    const sentAt = isSendNow ? new Date().toISOString() : null;
    const reviewReq = {
      id: reqId,
      agencyId,
      locationId,
      contactId,
      channel,
      message: String(message).trim(),
      scheduledAt: scheduledAt || new Date().toISOString(),
      status: isSendNow ? 'sent' : 'scheduled',
      sentAt,
      createdAt: new Date().toISOString()
    };

    state.records.reviewRequests = state.records.reviewRequests || [];
    state.records.reviewRequests.push(reviewReq);

    if (isSendNow) {
      state.records.conversations = state.records.conversations || [];
      let conv = state.records.conversations.find(
        c => c.agencyId === agencyId && c.contactId === contactId && c.channel === reviewReq.channel
      );
      if (!conv) {
        conv = {
          id: randomUUID(),
          agencyId,
          locationId,
          contactId,
          channel: reviewReq.channel,
          status: 'open',
          messages: [],
          createdAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
      }
      conv.messages = conv.messages || [];
      conv.messages.push({
        id: randomUUID(),
        sender: 'agent',
        body: reviewReq.message,
        sentAt,
        at: sentAt
      });
    }

    await saveState();
    auditLog?.('review.requested', actor, { requestId: reqId, contactId, channel: reviewReq.channel, sendNow: isSendNow });
    broadcast?.('review.requested', { request: reviewReq });
    sendJson(res, 201, { success: true, request: reviewReq });
    return true;
  }

  if (method === 'POST' && pathname.startsWith('/api/reviews/requests/') && pathname.endsWith('/send')) {
    if (!checkScope(actor, 'reviews:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (reviews:write required)' });
      return true;
    }
    const reqId = pathname.replace('/api/reviews/requests/', '').replace('/send', '').trim();
    state.records.reviewRequests = state.records.reviewRequests || [];
    const reviewReq = state.records.reviewRequests.find(r => r.id === reqId && r.agencyId === agencyId);
    if (!reviewReq) {
      sendJson(res, 404, { error: 'Review request not found' });
      return true;
    }

    const consentCheck = checkInMemoryConsent(state, {
      agencyId,
      locationId,
      contactId: reviewReq.contactId,
      channel: reviewReq.channel
    });
    if (!consentCheck.allowed) {
      sendJson(res, 403, {
        error: `Review request blocked by communication consent (${consentCheck.reason})`,
        code: 'ConsentRevoked'
      });
      return true;
    }

    reviewReq.status = 'sent';
    reviewReq.sentAt = new Date().toISOString();
    await saveState();
    auditLog?.('review.request_sent', actor, { requestId: reqId, contactId: reviewReq.contactId });
    broadcast?.('review.requested', { request: reviewReq });
    sendJson(res, 200, { success: true, request: reviewReq });
    return true;
  }

  // ── 3b. Reply to Review ───────────────────────────────────────────────────
  if (method === 'POST' && pathname.startsWith('/api/reviews/') && pathname.endsWith('/reply')) {
    if (!checkScope(actor, 'reviews:write', ['crm:write'])) {
      sendJson(res, 403, { error: 'Insufficient API key scope (reviews:write required)' });
      return true;
    }
    const reviewId = pathname.replace('/api/reviews/', '').replace('/reply', '').trim();
    const body = stripTenantFields(await readBody(req));
    const reply = String(body.reply || '').trim();
    if (!reply) {
      sendJson(res, 400, { error: 'Reply text is required' });
      return true;
    }

    state.records.reviews = state.records.reviews || [];
    const review = state.records.reviews.find(r => r.id === reviewId && r.agencyId === agencyId);
    if (!review) {
      sendJson(res, 404, { error: 'Review not found' });
      return true;
    }
    review.reply = reply;
    review.status = 'replied';
    review.repliedAt = new Date().toISOString();
    await saveState();
    auditLog?.('review.replied', actor, { reviewId, contactName: review.contactName });
    broadcast?.('review.replied', { id: review.id, reply, status: review.status, repliedAt: review.repliedAt });
    sendJson(res, 200, { success: true, review });
    return true;
  }

  // ── 4. /api/crm/reviews CRUD ──────────────────────────────────────────────
  if (pathname === '/api/crm/reviews' || pathname.startsWith('/api/crm/reviews/')) {
    const revId = pathname === '/api/crm/reviews' ? null : pathname.replace('/api/crm/reviews/', '').trim();

    if (method === 'GET' && !revId) {
      if (!checkScope(actor, 'reviews:read', ['crm:read'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (reviews:read required)' });
        return true;
      }
      if (pgPool) {
        const rows = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          reviewsRepo.listReviews(tx, { agencyId, locationId })
        );
        sendJson(res, 200, { data: rows, reviews: rows, total: rows.length });
        return true;
      }
      const rows = (state.records?.reviews || []).filter(r => r.agencyId === agencyId && (!locationId || r.locationId === locationId));
      sendJson(res, 200, { data: rows, reviews: rows, total: rows.length });
      return true;
    }

    if ((method === 'PUT' || method === 'PATCH') && revId) {
      if (!checkScope(actor, 'reviews:write', ['crm:write'])) {
        sendJson(res, 403, { error: 'Insufficient API key scope (reviews:write required)' });
        return true;
      }
      const body = stripTenantFields(await readBody(req));
      let updated;
      if (pgPool) {
        updated = await runInTenantTx(pgPool, { agencyId, locationId, actorId }, tx =>
          reviewsRepo.updateReview(tx, { agencyId, locationId, id: revId, patch: body })
        );
      } else {
        const rev = (state.records?.reviews || []).find(r => r.id === revId && r.agencyId === agencyId);
        if (rev) {
          if (body.status) rev.status = body.status;
          if (body.reply !== undefined) {
            rev.reply = body.reply;
            rev.repliedAt = new Date().toISOString();
          }
          rev.updatedAt = new Date().toISOString();
          await saveState();
          updated = rev;
        }
      }
      if (!updated) {
        sendJson(res, 404, { error: 'Review not found' });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }
  }

  return false;
}
