/**
 * ============================================================================
 * Operza Scheduling Domain Router — TenantTx & SchedulingRepository Boundary
 * ============================================================================
 * Handles all calendar and appointment aggregate endpoints:
 * 1. CRM Calendars CRUD: /api/crm/calendars, /api/crm/calendars/:id
 * 2. CRM Appointments CRUD: /api/crm/appointments, /api/crm/appointments/:id
 * 3. Public Booking Ingress: /api/calendars/public/:idOrSlug, /api/calendars/book/:idOrSlug
 * 4. 2-Way Calendar Sync & OAuth: /api/calendars/:id/oauth/start, /api/calendars/oauth/callback, /api/calendars/:id/sync/*
 *
 * For database-backed environments (pgPool present), PostgreSQL Row Level
 * Security via TenantTx is the sole authoritative persistence mechanism.
 * In-memory / JSON persistence is strictly isolated as a fallback for zero-config
 * local development and offline testing (!pgPool).
 */

import crypto, { randomUUID } from 'node:crypto';
import { createSchedulingRepository } from '../../../packages/db/lib/scheduling-repository.mjs';
import { runInTenantTx } from '../../../packages/db/lib/tenant-tx.mjs';
import { createPostgresOAuthStateStore } from '../../../packages/db/lib/outlook-oauth-state-repository.mjs';
import { createMemoryOAuthStateStore } from '../../../packages/platform-core/src/outlook-oauth.mjs';
import {
  executeCalendarSync,
  generatePKCE,
  googleCalendarAdapter,
  microsoftGraphCalendarAdapter,
  signOAuthState,
  verifyOAuthState
} from '../../../packages/platform-core/src/calendar-sync.mjs';

const schedulingRepo = createSchedulingRepository();

/**
 * Checks whether an actor API key possesses the required scope.
 *
 * @param {any} actor
 * @param {string} requiredScope
 * @param {string[]} [alternativeScopes]
 * @returns {boolean}
 */
function checkScope(actor, requiredScope, alternativeScopes = []) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  return alternativeScopes.some(alt => scopes.includes(alt));
}

/**
 * Handles all scheduling-related HTTP requests.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {any} ctx
 * @returns {Promise<boolean>} - true if request was handled, false if unhandled
 */
export async function handleSchedulingRoutes(req, res, ctx) {
  const {
    method,
    pathname,
    url,
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
    dispatchZapierEvent,
    zapierRepository,
    syncRelationalWrite,
    secretResolver,
    effectiveVaultKey,
    isProd
  } = ctx;

  const isSchedulingRoute =
    pathname.startsWith('/api/crm/calendars') ||
    pathname.startsWith('/api/crm/appointments') ||
    pathname.startsWith('/api/calendars') ||
    pathname.startsWith('/api/appointments');

  if (!isSchedulingRoute) {
    return false;
  }

  const queryUrl = url || new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
  const tenantCtx = (agency && activeLocation) ? {
    agencyId: agency.id,
    locationId: activeLocation.id,
    actorId: actor?.user?.id || actor?.keyId || 'system'
  } : null;

  function requireTenantContext() {
    if (!tenantCtx || !tenantCtx.agencyId || !tenantCtx.locationId) {
      sendJson(res, 400, { error: 'Active agency and location context required', code: 'TENANT_CONTEXT_REQUIRED' });
      return false;
    }
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 1. PUBLIC CALENDAR INGRESS (UNAUTHENTICATED)
  // ═════════════════════════════════════════════════════════════════════════

  // GET /api/calendars/public/:idOrSlug
  if (method === 'GET' && pathname.startsWith('/api/calendars/public/')) {
    const idOrSlug = pathname.replace('/api/calendars/public/', '').trim();
    let cal = null;

    if (pgPool) {
      try {
        let calRes;
        try {
          calRes = await pgPool.query("SELECT * FROM lookup_public_calendar($1)", [idOrSlug]);
        } catch {
          calRes = await pgPool.query(
            "SELECT * FROM calendars WHERE (id::text = $1 OR slug = $1) AND status != 'inactive' LIMIT 1",
            [idOrSlug]
          );
        }
        if (calRes.rows.length > 0) {
          const row = calRes.rows[0];
          cal = {
            id: row.id,
            agencyId: row.agency_id,
            locationId: row.location_id,
            name: row.name,
            slug: row.slug,
            durationMin: row.duration_min,
            color: row.color,
            description: row.description,
            status: row.status,
            availability: typeof row.availability === 'string' ? JSON.parse(row.availability) : (row.availability || {})
          };
        }
      } catch (err) {
        console.warn('[SCHEDULING-ROUTER] Error looking up public calendar in PostgreSQL:', err.message);
      }
    }

    if (!cal && state?.records?.calendars) {
      const match = state.records.calendars.find(c => (c.id === idOrSlug || c.slug === idOrSlug) && c.status !== 'inactive');
      if (match) cal = match;
    }

    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found or inactive' });
      return true;
    }

    // Generate standard slots if query date is provided
    const dateParam = queryUrl.searchParams.get('date');
    let slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'];

    if (dateParam) {
      const bookedStarts = [];

      if (pgPool) {
        try {
          const client = await pgPool.connect();
          try {
            await client.query("SELECT set_config('app.agency_id', $1, true)", [String(cal.agencyId)]);
            await client.query("SELECT set_config('app.location_id', $1, true)", [String(cal.locationId)]);
            const pgAppts = await client.query(
              "SELECT starts_at FROM appointments WHERE calendar_id = $1 AND starts_at::text LIKE $2 AND status != 'cancelled'",
              [cal.id, `${dateParam}%`]
            );
            for (const r of pgAppts.rows) {
              const tp = new Date(r.starts_at).toISOString().split('T')[1]?.slice(0, 5);
              if (tp && !bookedStarts.includes(tp)) bookedStarts.push(tp);
            }
          } finally {
            client.release();
          }
        } catch (err) {
          console.warn('[SCHEDULING-ROUTER] Error querying booked appointments in PostgreSQL:', err.message);
        }
      } else if (state?.records?.appointments) {
        const inMemBooked = state.records.appointments
          .filter(a => a.calendarId === cal.id && a.startsAt && a.startsAt.startsWith(dateParam) && a.status !== 'cancelled')
          .map(a => a.startsAt.split('T')[1]?.slice(0, 5));
        for (const t of inMemBooked) {
          if (t && !bookedStarts.includes(t)) bookedStarts.push(t);
        }
      }

      // Filter out external synced busy blocks
      const busyList = cal.externalBusyBlocks || cal.availability?.externalBusyBlocks || [];
      const externalBusy = busyList
        .filter(b => b.start && b.start.startsWith(dateParam))
        .map(b => b.start.split('T')[1]?.slice(0, 5));

      const blockedSet = new Set([...bookedStarts, ...externalBusy]);
      slots = slots.filter(s => !blockedSet.has(s));
    }

    sendJson(res, 200, {
      id: cal.id,
      name: cal.name,
      slug: cal.slug,
      color: cal.color || '#6366f1',
      durationMin: cal.durationMin || 30,
      description: cal.description || '',
      availability: cal.availability || [],
      availableSlots: slots,
      slots
    });
    return true;
  }

  // POST /api/calendars/book/:idOrSlug
  if (method === 'POST' && pathname.startsWith('/api/calendars/book/')) {
    const idOrSlug = pathname.replace('/api/calendars/book/', '').trim();
    let cal = null;

    if (pgPool) {
      try {
        let calRes;
        try {
          calRes = await pgPool.query("SELECT * FROM lookup_public_calendar($1)", [idOrSlug]);
        } catch {
          calRes = await pgPool.query(
            "SELECT * FROM calendars WHERE (id::text = $1 OR slug = $1) AND status != 'inactive' LIMIT 1",
            [idOrSlug]
          );
        }
        if (calRes.rows.length > 0) {
          const row = calRes.rows[0];
          cal = {
            id: row.id,
            agencyId: row.agency_id,
            locationId: row.location_id,
            name: row.name,
            slug: row.slug,
            durationMin: row.duration_min,
            color: row.color,
            description: row.description,
            status: row.status,
            roundRobin: Boolean(row.round_robin),
            availability: typeof row.availability === 'string' ? JSON.parse(row.availability) : (row.availability || {})
          };
        }
      } catch (err) {
        console.warn('[SCHEDULING-ROUTER] Error looking up calendar in PostgreSQL:', err.message);
      }
    }

    if (!cal && state?.records?.calendars) {
      const match = state.records.calendars.find(c => (c.id === idOrSlug || c.slug === idOrSlug) && c.status !== 'inactive');
      if (match) cal = match;
    }

    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found or inactive' });
      return true;
    }

    const body = await readBody(req);
    if (body.website || body.hp || body.company_fax) {
      sendJson(res, 400, { error: 'Bot submission rejected', code: 'BOT_SUBMISSION_REJECTED' });
      return true;
    }

    const { name, email, phone, date, timeSlot, notes } = body;
    if (!name || !email || !date || !timeSlot) {
      sendJson(res, 400, { error: 'Name, email, date, and timeSlot are required.' });
      return true;
    }

    const emailKey = String(email).toLowerCase().trim();
    const nameParts = String(name).trim().split(/\s+/);
    const firstName = nameParts[0] || 'Valued';
    const lastName = nameParts.slice(1).join(' ') || 'Client';

    const apptId = randomUUID();
    const startTime = `${date}T${timeSlot}:00.000Z`;
    const durationMin = cal.durationMin || 30;
    const endTime = new Date(new Date(startTime).getTime() + durationMin * 60000).toISOString();

    let contact = (state?.records?.contacts || []).find(
      c => c.agencyId === cal.agencyId && c.locationId === cal.locationId && c.email === emailKey
    );

    if (!contact) {
      contact = {
        id: randomUUID(),
        agencyId: cal.agencyId,
        locationId: cal.locationId,
        firstName,
        lastName,
        email: emailKey,
        phone: phone || '',
        source: `Calendar: ${cal.name}`,
        tags: ['booked-call', cal.slug || 'discovery'],
        status: 'lead',
        createdAt: new Date().toISOString()
      };
    } else {
      contact.tags = contact.tags || [];
      if (!contact.tags.includes('booked-call')) contact.tags.push('booked-call');
      if (phone && !contact.phone) contact.phone = phone;
    }

    const appointment = {
      id: apptId,
      agencyId: cal.agencyId,
      locationId: cal.locationId,
      calendarId: cal.id,
      contactId: contact.id,
      title: `${cal.name} with ${firstName} ${lastName}`,
      contactName: `${firstName} ${lastName}`,
      calendar: cal.name,
      startsAt: startTime,
      endsAt: endTime,
      status: 'confirmed',
      assignedTo: cal.roundRobin ? 'Growth Lead' : 'Lead Specialist',
      notes: notes || '',
      createdAt: new Date().toISOString()
    };

    // PostgreSQL Transactional Reservation with GiST Concurrency Lock
    if (pgPool) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        await client.query("SELECT set_config('app.agency_id', $1, true)", [String(cal.agencyId)]);
        await client.query("SELECT set_config('app.location_id', $1, true)", [String(cal.locationId)]);

        // Ensure parent agency and location exist in relational tables for FK integrity
        await client.query(`
          INSERT INTO agencies (id, name, slug)
          VALUES ($1, 'Agency', $2)
          ON CONFLICT (id) DO NOTHING
        `, [cal.agencyId, 'agency-' + String(cal.agencyId).slice(0, 8)]);

        await client.query(`
          INSERT INTO locations (id, agency_id, name)
          VALUES ($1, $2, 'Main Location')
          ON CONFLICT (agency_id, id) DO NOTHING
        `, [cal.locationId, cal.agencyId]);

        // Insert appointment with GiST exclusion check
        await client.query(`
          INSERT INTO appointments (
            id, agency_id, location_id, calendar_id, contact_id, title, starts_at, ends_at, status, notes, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'confirmed', $9, now(), now())
        `, [
          apptId,
          cal.agencyId,
          cal.locationId,
          cal.id,
          contact.id,
          appointment.title,
          startTime,
          endTime,
          notes || ''
        ]);

        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK').catch(() => {});
        if (dbErr.code === '23P01' || dbErr.message?.includes('exclude_overlapping_active_appointments')) {
          sendJson(res, 409, {
            error: 'This time slot is no longer available. Please choose another time.',
            code: 'SLOT_CONFLICT'
          });
          return true;
        }
        console.error('[SCHEDULING-ROUTER] Booking database error:', dbErr);
        sendJson(res, 500, { error: 'Failed to complete appointment booking', code: 'BOOKING_FAILED' });
        return true;
      } finally {
        client.release();
      }
    } else {
      // In-memory fallback
      const isSlotConflict = (state?.records?.appointments || []).some(
        a => a.calendarId === cal.id && a.startsAt.startsWith(date) && a.startsAt.includes(`T${timeSlot}:`) && a.status !== 'cancelled'
      );
      if (isSlotConflict) {
        sendJson(res, 409, { error: 'This time slot is no longer available. Please choose another time.', code: 'SLOT_CONFLICT' });
        return true;
      }
    }

    if (state?.records) {
      state.records.contacts = state.records.contacts || [];
      if (!state.records.contacts.some(c => c.id === contact.id)) {
        state.records.contacts.push(contact);
      }
      state.records.appointments = state.records.appointments || [];
      state.records.appointments.push(appointment);

      const taskId = randomUUID();
      const prepTask = {
        id: taskId,
        agencyId: cal.agencyId,
        locationId: cal.locationId,
        title: `Prepare discovery notes for ${firstName} ${lastName}`,
        contactId: contact.id,
        dueDate: startTime,
        priority: 'high',
        status: 'pending',
        assignedTo: appointment.assignedTo,
        notes: `Automated booking prep task. Meeting scheduled for ${date} at ${timeSlot}. Attendee notes: ${notes || 'None'}`,
        createdAt: new Date().toISOString()
      };
      state.records.tasks = state.records.tasks || [];
      state.records.tasks.push(prepTask);

      await saveState();

      if (broadcast) {
        broadcast('crm.appointment.created', { id: apptId, title: appointment.title, startsAt: startTime, contactId: contact.id });
        broadcast('crm.task.created', { id: taskId, title: prepTask.title });
      }

      if (triggerWorkflowExecution) {
        triggerWorkflowExecution({
          agencyId: cal.agencyId,
          locationId: cal.locationId,
          triggerType: 'appointment',
          triggerContext: { calendar: cal, appointment, contact, prepTask }
        }).catch(err => console.error('Appointment workflow trigger failed:', err));
      }

      if (dispatchZapierEvent) {
        dispatchZapierEvent({
          zapierRepository,
          state,
          agencyId: cal.agencyId,
          locationId: cal.locationId,
          event: 'appointment.booked',
          data: {
            appointmentId: appointment.id,
            calendarName: cal.name,
            contactName: `${firstName} ${lastName}`,
            contactEmail: contact.email,
            scheduledAt: appointment.startsAt,
            status: appointment.status
          }
        }).catch(console.error);
      }

      sendJson(res, 201, {
        success: true,
        message: 'Appointment successfully confirmed.',
        appointment,
        contact,
        prepTask
      });
      return true;
    }

    sendJson(res, 201, {
      success: true,
      message: 'Appointment successfully confirmed.',
      appointment,
      contact
    });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 2. 2-WAY CALENDAR SYNC & OAUTH
  // ═════════════════════════════════════════════════════════════════════════

  // GET /api/calendars/:id/oauth/start
  if (method === 'GET' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/oauth/start')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/oauth/start', '').trim();
    if (!requireTenantContext()) return true;

    let cal = null;
    if (state?.records?.calendars) {
      cal = state.records.calendars.find(c => c.id === calId && c.agencyId === agency.id);
    }
    if (!cal && pgPool) {
      const calRes = await pgPool.query('SELECT * FROM calendars WHERE agency_id = $1 AND id = $2', [agency.id, calId]);
      if (calRes.rows.length > 0) {
        const row = calRes.rows[0];
        cal = {
          id: row.id,
          agencyId: row.agency_id,
          locationId: row.location_id,
          name: row.name,
          slug: row.slug,
          durationMin: row.duration_min,
          status: row.status,
          availability: row.availability || {},
          externalSync: row.availability?.externalSync || null,
          externalBusyBlocks: row.availability?.externalBusyBlocks || []
        };
      }
    }
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }

    const provider = queryUrl.searchParams.get('provider') || 'google_calendar';
    const redirectUri = `${process.env.APP_BASE_URL || queryUrl.origin}/api/calendars/oauth/callback`;
    let authorizationUrl = '';

    const pkce = generatePKCE();
    const stateNonce = crypto.randomUUID();
    const expiresAt = Date.now() + 600_000;
    const statePayload = {
      tenantId: agency.id,
      locationId: activeLocation.id,
      actorId: actor?.user?.id || 'system',
      calendarId: cal.id,
      provider,
      nonce: stateNonce,
      expiresAt,
      createdAt: Date.now()
    };
    const signedState = signOAuthState(statePayload, effectiveVaultKey);
    const stateHash = crypto.createHash('sha256').update(signedState).digest('hex');

    const oauthStore = pgPool
      ? createPostgresOAuthStateStore(pgPool, { masterKey: effectiveVaultKey })
      : (globalThis.__calendarOAuthMemoryStore = globalThis.__calendarOAuthMemoryStore || createMemoryOAuthStateStore());

    await oauthStore.create({
      stateHash,
      tenantId: agency.id,
      locationId: activeLocation.id,
      actorId: actor?.user?.id || 'system',
      codeVerifier: pkce.verifier,
      expiresAt
    });

    if (provider === 'google_calendar' || provider === 'google') {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      if (!clientId) {
        sendJson(res, 400, {
          error: 'Google Calendar credentials are not configured on this server',
          code: 'GOOGLE_CONFIG_MISSING'
        });
        return true;
      }
      authorizationUrl = googleCalendarAdapter.getAuthorizationUrl({
        clientId,
        redirectUri,
        stateKey: effectiveVaultKey,
        tenantId: agency.id,
        locationId: activeLocation.id,
        calendarId: cal.id,
        codeChallenge: pkce.challenge,
        state: signedState
      });
    } else if (provider === 'outlook' || provider === 'microsoft_graph') {
      const clientId = process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID;
      if (!clientId) {
        sendJson(res, 400, {
          error: 'Microsoft Calendar credentials are not configured on this server',
          code: 'MICROSOFT_CONFIG_MISSING'
        });
        return true;
      }
      authorizationUrl = microsoftGraphCalendarAdapter.getAuthorizationUrl({
        clientId,
        redirectUri,
        stateKey: effectiveVaultKey,
        tenantId: agency.id,
        locationId: activeLocation.id,
        calendarId: cal.id,
        codeChallenge: pkce.challenge,
        state: signedState
      });
    } else {
      sendJson(res, 400, { error: 'Unsupported calendar provider', code: 'UNSUPPORTED_PROVIDER' });
      return true;
    }

    if (queryUrl.searchParams.get('redirect') === 'false') {
      sendJson(res, 200, { authorizationUrl, state: signedState });
      return true;
    }
    res.writeHead(302, { Location: authorizationUrl, 'Cache-Control': 'no-store' });
    res.end();
    return true;
  }

  // GET /api/calendars/oauth/callback
  if (method === 'GET' && pathname === '/api/calendars/oauth/callback') {
    const stateParam = queryUrl.searchParams.get('state');
    const code = queryUrl.searchParams.get('code');
    const error = queryUrl.searchParams.get('error');

    const destination = new URL('/calendars', process.env.APP_BASE_URL || process.env.FRONTEND_URL || queryUrl.origin);
    if (error || !stateParam || !code) {
      destination.searchParams.set('sync', 'denied');
      if (error) destination.searchParams.set('reason', error);
      res.writeHead(302, { Location: destination.toString(), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }

    try {
      const stateData = verifyOAuthState(stateParam, effectiveVaultKey);
      if (!stateData?.calendarId || !stateData?.tenantId || !stateData?.locationId) {
        throw Object.assign(new Error('Invalid state payload'), { code: 'OAUTH_STATE_INVALID' });
      }
      if (stateData.expiresAt && stateData.expiresAt <= Date.now()) {
        throw Object.assign(new Error('OAuth state expired'), { code: 'OAUTH_STATE_EXPIRED' });
      }

      const stateHash = crypto.createHash('sha256').update(stateParam).digest('hex');
      const oauthStore = pgPool
        ? createPostgresOAuthStateStore(pgPool, { masterKey: effectiveVaultKey })
        : (globalThis.__calendarOAuthMemoryStore = globalThis.__calendarOAuthMemoryStore || createMemoryOAuthStateStore());

      const consumed = await oauthStore.consume({
        stateHash,
        tenantId: stateData.tenantId,
        locationId: stateData.locationId
      });

      if (!consumed || !consumed.codeVerifier) {
        throw Object.assign(new Error('OAuth state was already consumed or not found'), { code: 'OAUTH_STATE_CONSUMED' });
      }
      if (consumed.expiresAt && consumed.expiresAt <= Date.now()) {
        throw Object.assign(new Error('OAuth state expired before token exchange'), { code: 'OAUTH_STATE_EXPIRED' });
      }

      const codeVerifier = consumed.codeVerifier;

      let calendars = state?.records?.calendars || [];
      let cal = calendars.find(c => c.id === stateData.calendarId && c.agencyId === stateData.tenantId);
      if (!cal && pgPool) {
        const calRes = await pgPool.query('SELECT * FROM calendars WHERE agency_id = $1 AND id = $2', [stateData.tenantId, stateData.calendarId]);
        if (calRes.rows.length > 0) {
          const row = calRes.rows[0];
          cal = {
            id: row.id,
            agencyId: row.agency_id,
            locationId: row.location_id,
            name: row.name,
            slug: row.slug,
            durationMin: row.duration_min,
            status: row.status,
            availability: row.availability || {},
            externalSync: row.availability?.externalSync || null,
            externalBusyBlocks: row.availability?.externalBusyBlocks || []
          };
          calendars.push(cal);
        }
      }
      if (!cal) throw new Error('Calendar not found');

      let tokenData = {};
      const redirectUri = `${process.env.APP_BASE_URL || queryUrl.origin}/api/calendars/oauth/callback`;

      if (stateData.provider === 'google_calendar') {
        tokenData = await googleCalendarAdapter.exchangeCode({
          code,
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          redirectUri,
          codeVerifier,
          fetchFn: globalThis.fetch
        });
      } else {
        tokenData = await microsoftGraphCalendarAdapter.exchangeCode({
          code,
          clientId: process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET,
          redirectUri,
          codeVerifier,
          fetchFn: globalThis.fetch
        });
      }

      const secretRef = `vault:${cal.agencyId}/${cal.locationId}/calendar_${cal.id}`;
      if (secretResolver) {
        await secretResolver.store(secretRef, JSON.stringify({
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          provider: stateData.provider,
          email: tokenData.email || 'operator@operza.io'
        }));
      }

      cal.externalSync = {
        provider: stateData.provider,
        email: tokenData.email || 'operator@operza.io',
        calendarName: tokenData.calendarName || `${stateData.provider === 'google_calendar' ? 'Google' : 'Outlook'} Calendar`,
        syncDirection: 'two_way',
        status: 'active',
        lastSyncAt: new Date().toISOString(),
        connectedAt: new Date().toISOString(),
        secretRef
      };
      delete cal.externalSync.accessToken;
      delete cal.externalSync.refreshToken;

      if (cal.availability) {
        cal.availability.externalSync = { ...cal.externalSync };
      }

      await saveState();
      if (syncRelationalWrite) {
        await syncRelationalWrite('calendars', 'update', cal, cal.agencyId);
      }

      destination.searchParams.set('calendarId', cal.id);
      destination.searchParams.set('sync', 'connected');
      res.writeHead(302, { Location: destination.toString(), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    } catch (cbErr) {
      destination.searchParams.set('sync', 'failed');
      destination.searchParams.set('reason', cbErr.message);
      res.writeHead(302, { Location: destination.toString(), 'Cache-Control': 'no-store' });
      res.end();
      return true;
    }
  }

  // GET /api/calendars/:id/sync/calendars
  if (method === 'GET' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/calendars')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/calendars', '').trim();
    if (!requireTenantContext()) return true;

    let calendars = state?.records?.calendars || [];
    let cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal && pgPool) {
      const calRes = await pgPool.query('SELECT * FROM calendars WHERE agency_id = $1 AND id = $2', [agency.id, calId]);
      if (calRes.rows.length > 0) {
        const row = calRes.rows[0];
        cal = {
          id: row.id,
          agencyId: row.agency_id,
          locationId: row.location_id,
          name: row.name,
          slug: row.slug,
          durationMin: row.duration_min,
          status: row.status,
          availability: row.availability || {},
          externalSync: row.availability?.externalSync || null,
          externalBusyBlocks: row.availability?.externalBusyBlocks || []
        };
      }
    }
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }
    if (!cal.externalSync?.secretRef || !secretResolver) {
      sendJson(res, 400, { error: 'Calendar is not connected with vault secrets', code: 'CALENDAR_NOT_CONNECTED' });
      return true;
    }

    const raw = await secretResolver.resolve(cal.externalSync.secretRef);
    const creds = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const isGoogle = cal.externalSync.provider === 'google_calendar' || cal.externalSync.provider === 'google';
    const adapter = isGoogle ? googleCalendarAdapter : microsoftGraphCalendarAdapter;
    const clientId = isGoogle ? process.env.GOOGLE_CLIENT_ID : (process.env.MICROSOFT_CLIENT_ID || process.env.AZURE_AD_CLIENT_ID);
    const clientSecret = isGoogle ? process.env.GOOGLE_CLIENT_SECRET : (process.env.MICROSOFT_CLIENT_SECRET || process.env.AZURE_AD_CLIENT_SECRET);

    const list = await adapter.listCalendars({
      accessToken: creds?.accessToken,
      refreshToken: creds?.refreshToken,
      clientId,
      clientSecret,
      fetchFn: globalThis.fetch
    });
    sendJson(res, 200, { calendars: list });
    return true;
  }

  // POST /api/calendars/:id/sync/connect
  if (method === 'POST' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/connect')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/connect', '').trim();
    if (!requireTenantContext()) return true;

    let calendars = state?.records?.calendars || [];
    let cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal && pgPool) {
      const calRes = await pgPool.query('SELECT * FROM calendars WHERE agency_id = $1 AND id = $2', [agency.id, calId]);
      if (calRes.rows.length > 0) {
        const row = calRes.rows[0];
        cal = {
          id: row.id,
          agencyId: row.agency_id,
          locationId: row.location_id,
          name: row.name,
          slug: row.slug,
          durationMin: row.duration_min,
          status: row.status,
          availability: row.availability || {},
          externalSync: row.availability?.externalSync || null,
          externalBusyBlocks: row.availability?.externalBusyBlocks || []
        };
        calendars.push(cal);
      }
    }
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }

    const body = await readBody(req);
    const provider = body.provider || 'google_calendar';
    const token = body.accessToken || body.apiKey || body.token;
    const refreshToken = body.refreshToken;

    let verification = { verified: true, calendarName: body.calendarName };
    if (token || refreshToken) {
      let adapter = null;
      if (provider === 'google_calendar' || provider === 'google') {
        adapter = googleCalendarAdapter;
      } else if (provider === 'microsoft_graph' || provider === 'outlook') {
        adapter = microsoftGraphCalendarAdapter;
      } else {
        sendJson(res, 400, {
          success: false,
          code: 'UNSUPPORTED_CALENDAR_PROVIDER',
          error: `Provider '${provider}' is not supported for calendar synchronization.`
        });
        return true;
      }

      verification = await adapter.verify({
        accessToken: token,
        refreshToken,
        clientId: body.clientId,
        clientSecret: body.clientSecret,
        fetchFn: globalThis.fetch
      });

      if (!verification.verified) {
        sendJson(res, 401, {
          success: false,
          code: verification.code || 'CALENDAR_AUTH_FAILED',
          error: 'Calendar provider rejected authorization: invalid or expired credentials'
        });
        return true;
      }
    } else if (!isProd && Array.isArray(body.busyBlocks)) {
      verification = { verified: true, calendarName: body.calendarName || 'Simulated Calendar' };
    } else {
      sendJson(res, 401, {
        success: false,
        code: 'CALENDAR_AUTH_FAILED',
        error: 'Calendar provider authorization required: missing access token or refresh token'
      });
      return true;
    }

    const email = verification.email || body.email || actor?.user?.email || 'operator@operza.io';
    const secretRef = `vault:${cal.agencyId}/${cal.locationId}/calendar_${cal.id}`;
    if (secretResolver) {
      await secretResolver.store(secretRef, JSON.stringify({
        accessToken: verification.freshAccessToken || token,
        refreshToken: refreshToken || null,
        provider,
        email
      }));
    }

    cal.externalSync = {
      provider,
      email,
      calendarName: verification.calendarName || body.calendarName || `${provider === 'google_calendar' ? 'Google' : 'Outlook'} Calendar (${email})`,
      syncDirection: body.syncDirection || 'two_way',
      status: 'active',
      lastSyncAt: new Date().toISOString(),
      connectedAt: new Date().toISOString(),
      secretRef
    };

    delete cal.externalSync.accessToken;
    delete cal.externalSync.refreshToken;
    delete cal.externalSync.apiKey;
    delete cal.externalSync.token;
    if (cal.availability) {
      cal.availability.externalSync = { ...cal.externalSync };
      delete cal.availability.externalSync.accessToken;
      delete cal.availability.externalSync.refreshToken;
    }

    if (Array.isArray(body.busyBlocks)) {
      cal.externalBusyBlocks = body.busyBlocks;
    } else {
      let syncClient = null;
      let appts = state?.records?.appointments || [];
      if (pgPool) {
        syncClient = await pgPool.connect();
        await syncClient.query('BEGIN');
        await syncClient.query(
          "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
          [agency.id, activeLocation.id]
        );
        const pgAppts = await syncClient.query(`
          SELECT id, agency_id as "agencyId", location_id as "locationId", calendar_id as "calendarId",
                 title, starts_at as "startsAt", ends_at as "endsAt", status, notes, external_event_id as "externalEventId"
          FROM appointments
          WHERE agency_id = $1 AND location_id = $2 AND calendar_id = $3
          ORDER BY starts_at ASC
        `, [agency.id, activeLocation.id, cal.id]);
        appts = pgAppts.rows;
      }
      try {
        const syncResult = await executeCalendarSync({
          calendar: cal,
          appointments: appts,
          syncDirection: cal.externalSync.syncDirection,
          credentials: { accessToken: verification.freshAccessToken || token, refreshToken },
          fetchFn: globalThis.fetch
        });

        if (syncClient && syncResult.exportedEvents?.length) {
          for (const exp of syncResult.exportedEvents) {
            const updateRes = await syncClient.query(`
              UPDATE appointments
              SET external_event_id = $1, updated_at = now()
              WHERE agency_id = $2 AND location_id = $3 AND calendar_id = $4 AND id = $5
            `, [exp.externalId, agency.id, activeLocation.id, cal.id, exp.appointmentId]);

            if (updateRes.rowCount !== 1) {
              throw Object.assign(new Error(`Failed to persist external event ID for appointment ${exp.appointmentId}: record not found or tenant mismatch`), {
                code: 'APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED',
                appointmentId: exp.appointmentId
              });
            }
          }
        }

        if (syncClient) {
          await syncClient.query('COMMIT');
        }
        cal.externalBusyBlocks = syncResult.busyBlocks;
        cal.externalSync.lastSyncAt = syncResult.lastSyncAt;
      } catch (syncErr) {
        if (syncClient) {
          await syncClient.query('ROLLBACK').catch(() => {});
        }
        console.warn('[CALENDAR-SYNC] Initial busy block fetch warning:', syncErr.message);
      } finally {
        if (syncClient) {
          syncClient.release();
        }
      }
    }

    cal.updatedAt = new Date().toISOString();
    await saveState();
    if (syncRelationalWrite) {
      await syncRelationalWrite('calendars', 'update', cal, agency.id);
    }

    if (auditLog) auditLog('calendar.sync.connected', actor, { calendarId: cal.id, provider, email });
    if (broadcast) broadcast('crm.calendar.synced', { calendarId: cal.id, externalSync: cal.externalSync });

    sendJson(res, 200, { success: true, externalSync: cal.externalSync, calendar: cal });
    return true;
  }

  // POST /api/calendars/:id/sync/now
  if (method === 'POST' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/now')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/now', '').trim();
    if (!requireTenantContext()) return true;

    const calendars = state?.records?.calendars || [];
    const cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }
    if (!cal.externalSync || !['active', 'connected'].includes(cal.externalSync.status)) {
      sendJson(res, 400, { error: 'Calendar is not connected to an external provider', code: 'CALENDAR_NOT_CONNECTED' });
      return true;
    }

    let credentials = {};
    if (secretResolver && cal.externalSync.secretRef) {
      const raw = await secretResolver.resolve(cal.externalSync.secretRef).catch(() => null);
      if (raw) {
        try { credentials = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { credentials = { accessToken: raw }; }
      }
    } else if (cal.externalSync.accessToken) {
      credentials = { accessToken: cal.externalSync.accessToken, refreshToken: cal.externalSync.refreshToken };
    }

    let appts = state?.records?.appointments || [];
    let syncClient = null;
    if (pgPool) {
      syncClient = await pgPool.connect();
      await syncClient.query('BEGIN');
      await syncClient.query(
        "SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)",
        [agency.id, activeLocation.id]
      );
      const pgAppts = await syncClient.query(`
        SELECT id, agency_id as "agencyId", location_id as "locationId", calendar_id as "calendarId",
               title, starts_at as "startsAt", ends_at as "endsAt", status, notes, external_event_id as "externalEventId"
        FROM appointments
        WHERE agency_id = $1 AND location_id = $2 AND calendar_id = $3
        ORDER BY starts_at ASC
      `, [agency.id, activeLocation.id, cal.id]);
      appts = pgAppts.rows;
    }

    try {
      const syncResult = await executeCalendarSync({
        calendar: cal,
        appointments: appts,
        syncDirection: cal.externalSync.syncDirection || 'two_way',
        credentials,
        fetchFn: globalThis.fetch
      });

      if (syncClient && syncResult.exportedEvents?.length) {
        for (const exp of syncResult.exportedEvents) {
          const updateRes = await syncClient.query(`
            UPDATE appointments
            SET external_event_id = $1, updated_at = now()
            WHERE agency_id = $2 AND location_id = $3 AND calendar_id = $4 AND id = $5
          `, [exp.externalId, agency.id, activeLocation.id, cal.id, exp.appointmentId]);

          if (updateRes.rowCount !== 1) {
            throw Object.assign(new Error(`Failed to persist external event ID for appointment ${exp.appointmentId}: record not found or tenant mismatch`), {
              code: 'APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED',
              appointmentId: exp.appointmentId
            });
          }
        }
      }

      if (syncClient) {
        await syncClient.query('COMMIT');
      }

      cal.externalBusyBlocks = syncResult.busyBlocks;
      cal.externalSync.lastSyncAt = syncResult.lastSyncAt;
      cal.externalSync.status = 'active';
      cal.updatedAt = new Date().toISOString();
      await saveState();
      if (syncRelationalWrite) {
        await syncRelationalWrite('calendars', 'update', cal, agency.id);
      }

      sendJson(res, 200, {
        success: true,
        calendarId: cal.id,
        busyBlocksCount: cal.externalBusyBlocks.length,
        lastSyncAt: cal.externalSync.lastSyncAt
      });
      return true;
    } catch (err) {
      if (syncClient) {
        await syncClient.query('ROLLBACK').catch(() => {});
      }
      if (err.code === 'CALENDAR_AUTH_FAILED' || err.code === 'CALENDAR_UNAUTHORIZED') {
        cal.externalSync.status = 'error';
        cal.updatedAt = new Date().toISOString();
        await saveState();
        if (syncRelationalWrite) {
          await syncRelationalWrite('calendars', 'update', cal, agency.id);
        }
        sendJson(res, 401, { error: 'Calendar provider authorization expired', code: 'CALENDAR_AUTH_FAILED' });
        return true;
      }
      if (err.code === 'APPOINTMENT_EXTERNAL_ID_PERSIST_FAILED') {
        sendJson(res, 500, { error: err.message, code: err.code });
        return true;
      }
      sendJson(res, 502, { error: err.message, code: err.code || 'CALENDAR_SYNC_FAILED' });
      return true;
    } finally {
      if (syncClient) {
        syncClient.release();
      }
    }
  }

  // POST /api/calendars/:id/sync/disconnect
  if (method === 'POST' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/disconnect')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/disconnect', '').trim();
    if (!requireTenantContext()) return true;

    const calendars = state?.records?.calendars || [];
    const cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }

    cal.externalSync = { status: 'disconnected', provider: null };
    cal.externalBusyBlocks = [];
    cal.updatedAt = new Date().toISOString();
    await saveState();
    if (syncRelationalWrite) {
      await syncRelationalWrite('calendars', 'update', cal, agency.id);
    }

    if (auditLog) auditLog('calendar.sync.disconnected', actor, { calendarId: cal.id });
    if (broadcast) broadcast('crm.calendar.synced', { calendarId: cal.id, externalSync: cal.externalSync });

    sendJson(res, 200, { success: true, calendarId: cal.id, externalSync: cal.externalSync });
    return true;
  }

  // GET /api/calendars/:id/sync/status
  if (method === 'GET' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/status')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/status', '').trim();
    if (!requireTenantContext()) return true;

    const calendars = state?.records?.calendars || [];
    const cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }

    sendJson(res, 200, {
      calendarId: cal.id,
      externalSync: cal.externalSync || { status: 'disconnected', provider: null },
      busyBlocksCount: (cal.externalBusyBlocks || []).length
    });
    return true;
  }

  // POST /api/calendars/:id/sync/busy
  if (method === 'POST' && pathname.startsWith('/api/calendars/') && pathname.endsWith('/sync/busy')) {
    const calId = pathname.replace('/api/calendars/', '').replace('/sync/busy', '').trim();
    if (!requireTenantContext()) return true;

    const calendars = state?.records?.calendars || [];
    const cal = calendars.find(c => c.id === calId && c.agencyId === agency.id);
    if (!cal) {
      sendJson(res, 404, { error: 'Calendar not found' });
      return true;
    }

    const body = await readBody(req);
    const busyBlocks = Array.isArray(body.busyBlocks) ? body.busyBlocks : [];
    cal.externalBusyBlocks = busyBlocks;
    if (cal.externalSync) cal.externalSync.lastSyncAt = new Date().toISOString();
    cal.updatedAt = new Date().toISOString();
    await saveState();

    sendJson(res, 200, { success: true, calendarId: cal.id, busyBlocksCount: cal.externalBusyBlocks.length });
    return true;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 3. CRM CALENDARS CRUD
  // ═════════════════════════════════════════════════════════════════════════

  const isCalendarsCrud =
    pathname === '/api/crm/calendars' ||
    pathname.startsWith('/api/crm/calendars/') ||
    pathname === '/api/calendars' ||
    (pathname.startsWith('/api/calendars/') && !pathname.includes('/sync') && !pathname.includes('/oauth') && !pathname.includes('/public') && !pathname.includes('/book'));

  if (isCalendarsCrud) {
    if (!requireTenantContext()) return true;

    const requiredScope = (method === 'GET' || method === 'HEAD') ? 'calendars:read' : 'calendars:write';
    if (!checkScope(actor, requiredScope, ['scheduling:read', 'scheduling:write'])) {
      sendJson(res, 403, {
        error: `Insufficient API key scope. Required: '${requiredScope}'`,
        code: 'INSUFFICIENT_SCOPES',
        requiredScope
      });
      return true;
    }

    const basePath = pathname.startsWith('/api/crm/calendars') ? '/api/crm/calendars' : '/api/calendars';
    const subPath = pathname.slice(basePath.length);
    const cleanSubPath = subPath.startsWith('/') ? subPath.slice(1) : subPath;
    const recordId = cleanSubPath.split('/')[0] || null;

    // GET /api/crm/calendars (List)
    if (method === 'GET' && !recordId) {
      if (pgPool) {
        try {
          const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
          const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
          const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
          const status = queryUrl.searchParams.get('status');
          const sortBy = queryUrl.searchParams.get('sort');
          const sortOrder = queryUrl.searchParams.get('order');

          const result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.listCalendars(tx, { page, limit, search, status, sortBy, sortOrder });
          });

          const totalPages = Math.ceil(result.total / limit);
          sendJson(res, 200, {
            data: result.calendars,
            calendars: result.calendars,
            pagination: { page, limit, total: result.total, totalPages, hasMore: page < totalPages }
          });
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error listing calendars from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to list calendars', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      // In-memory fallback
      let list = (state?.records?.calendars || []).filter(
        c => c.agencyId === agency.id && (!c.locationId || !activeLocation || c.locationId === activeLocation.id)
      );

      const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(c => (c.name && c.name.toLowerCase().includes(q)) || (c.slug && c.slug.toLowerCase().includes(q)));
      }

      const status = queryUrl.searchParams.get('status');
      if (status) {
        list = list.filter(c => c.status && c.status.toLowerCase() === status.toLowerCase());
      }

      const total = list.length;
      const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
      const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
      const startIdx = (page - 1) * limit;
      const pageData = list.slice(startIdx, startIdx + limit);
      const totalPages = Math.ceil(total / limit);

      sendJson(res, 200, {
        data: pageData,
        calendars: pageData,
        pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
      });
      return true;
    }

    // GET /api/crm/calendars/:id
    if (method === 'GET' && recordId) {
      if (pgPool) {
        try {
          const cal = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.getCalendarById(tx, recordId);
          });
          if (!cal) {
            sendJson(res, 404, { error: 'Calendar not found' });
            return true;
          }
          sendJson(res, 200, cal);
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error getting calendar from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to retrieve calendar', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      const cal = (state?.records?.calendars || []).find(
        c => c.id === recordId && c.agencyId === agency.id && (!c.locationId || !activeLocation || c.locationId === activeLocation.id)
      );
      if (!cal) {
        sendJson(res, 404, { error: 'Calendar not found' });
        return true;
      }
      sendJson(res, 200, cal);
      return true;
    }

    // POST /api/crm/calendars
    if (method === 'POST') {
      const body = await readBody(req);
      delete body.id;
      delete body.agencyId;
      delete body.locationId;

      if (pgPool) {
        try {
          const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.createCalendar(tx, body);
          });
          if (auditLog) auditLog('crm.calendars.created', actor, { id: created.id });
          if (broadcast) broadcast('crm.calendars.created', created);
          sendJson(res, 201, created);
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error creating calendar in PostgreSQL:', err);
          sendJson(res, 400, { error: err.message || 'Failed to create calendar', code: 'CREATE_FAILED' });
        }
        return true;
      }

      // In-memory fallback
      const assignedId = randomUUID();
      const newCal = {
        id: assignedId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        name: body.name || 'New Calendar',
        slug: body.slug || `cal-${assignedId.slice(0, 8)}`,
        color: body.color || '#4f46e5',
        durationMin: Number(body.durationMin ?? body.duration_min) || 30,
        availability: body.availability || {},
        roundRobin: Boolean(body.roundRobin ?? body.round_robin),
        description: body.description || '',
        status: body.status || 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.calendars = state.records.calendars || [];
      state.records.calendars.push(newCal);
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('calendars', 'create', newCal, agency.id);
      }
      if (auditLog) auditLog('crm.calendars.created', actor, { id: newCal.id });
      if (broadcast) broadcast('crm.calendars.created', newCal);

      sendJson(res, 201, newCal);
      return true;
    }

    // PUT /api/crm/calendars/:id
    if (method === 'PUT' && recordId) {
      const body = await readBody(req);
      delete body.id;
      delete body.agencyId;
      delete body.locationId;

      if (pgPool) {
        try {
          const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.updateCalendar(tx, recordId, body);
          });
          if (!updated) {
            sendJson(res, 404, { error: 'Calendar not found' });
            return true;
          }
          if (auditLog) auditLog('crm.calendars.updated', actor, { id: recordId });
          if (broadcast) broadcast('crm.calendars.updated', updated);
          sendJson(res, 200, updated);
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error updating calendar in PostgreSQL:', err);
          sendJson(res, 400, { error: err.message || 'Failed to update calendar', code: 'UPDATE_FAILED' });
        }
        return true;
      }

      // In-memory fallback
      state.records.calendars = state.records.calendars || [];
      const idx = state.records.calendars.findIndex(
        c => c.id === recordId && c.agencyId === agency.id && (!c.locationId || !activeLocation || c.locationId === activeLocation.id)
      );
      if (idx === -1) {
        sendJson(res, 404, { error: 'Calendar not found' });
        return true;
      }

      const updated = {
        ...state.records.calendars[idx],
        ...body,
        id: recordId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        updatedAt: new Date().toISOString()
      };
      state.records.calendars[idx] = updated;
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('calendars', 'update', updated, agency.id);
      }
      if (auditLog) auditLog('crm.calendars.updated', actor, { id: recordId });
      if (broadcast) broadcast('crm.calendars.updated', updated);

      sendJson(res, 200, updated);
      return true;
    }

    // DELETE /api/crm/calendars/:id
    if (method === 'DELETE' && recordId) {
      if (pgPool) {
        try {
          const ok = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.deleteCalendar(tx, recordId);
          });
          if (!ok) {
            sendJson(res, 404, { error: 'Calendar not found' });
            return true;
          }
          if (auditLog) auditLog('crm.calendars.deleted', actor, { id: recordId });
          if (broadcast) broadcast('crm.calendars.deleted', { id: recordId });
          sendJson(res, 200, { success: true });
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error deleting calendar from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to delete calendar', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      // In-memory fallback
      state.records.calendars = state.records.calendars || [];
      const idx = state.records.calendars.findIndex(
        c => c.id === recordId && c.agencyId === agency.id && (!c.locationId || !activeLocation || c.locationId === activeLocation.id)
      );
      if (idx === -1) {
        sendJson(res, 404, { error: 'Calendar not found' });
        return true;
      }

      state.records.calendars.splice(idx, 1);
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('calendars', 'delete', { id: recordId }, agency.id);
      }
      if (auditLog) auditLog('crm.calendars.deleted', actor, { id: recordId });
      if (broadcast) broadcast('crm.calendars.deleted', { id: recordId });

      sendJson(res, 200, { success: true });
      return true;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // 4. CRM APPOINTMENTS CRUD
  // ═════════════════════════════════════════════════════════════════════════

  const isAppointmentsCrud =
    pathname === '/api/crm/appointments' ||
    pathname.startsWith('/api/crm/appointments/') ||
    pathname === '/api/appointments' ||
    pathname.startsWith('/api/appointments/');

  if (isAppointmentsCrud) {
    if (!requireTenantContext()) return true;

    const requiredScope = (method === 'GET' || method === 'HEAD') ? 'appointments:read' : 'appointments:write';
    if (!checkScope(actor, requiredScope, ['scheduling:read', 'scheduling:write'])) {
      sendJson(res, 403, {
        error: `Insufficient API key scope. Required: '${requiredScope}'`,
        code: 'INSUFFICIENT_SCOPES',
        requiredScope
      });
      return true;
    }

    const basePath = pathname.startsWith('/api/crm/appointments') ? '/api/crm/appointments' : '/api/appointments';
    const subPath = pathname.slice(basePath.length);
    const cleanSubPath = subPath.startsWith('/') ? subPath.slice(1) : subPath;
    const recordId = cleanSubPath.split('/')[0] || null;

    // GET /api/crm/appointments (List)
    if (method === 'GET' && !recordId) {
      if (pgPool) {
        try {
          const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
          const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
          const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
          const status = queryUrl.searchParams.get('status');
          const calendarId = queryUrl.searchParams.get('calendarId') || queryUrl.searchParams.get('calendar_id');
          const contactId = queryUrl.searchParams.get('contactId') || queryUrl.searchParams.get('contact_id');
          const startsAfter = queryUrl.searchParams.get('startsAfter') || queryUrl.searchParams.get('from');
          const endsBefore = queryUrl.searchParams.get('endsBefore') || queryUrl.searchParams.get('to');
          const sortBy = queryUrl.searchParams.get('sort');
          const sortOrder = queryUrl.searchParams.get('order');

          const result = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.listAppointments(tx, {
              page,
              limit,
              search,
              status,
              calendarId,
              contactId,
              startsAfter,
              endsBefore,
              sortBy,
              sortOrder
            });
          });

          const totalPages = Math.ceil(result.total / limit);
          sendJson(res, 200, {
            data: result.appointments,
            appointments: result.appointments,
            pagination: { page, limit, total: result.total, totalPages, hasMore: page < totalPages }
          });
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error listing appointments from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to list appointments', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      // In-memory fallback
      let list = (state?.records?.appointments || []).filter(
        a => a.agencyId === agency.id && (!a.locationId || !activeLocation || a.locationId === activeLocation.id)
      );

      const search = queryUrl.searchParams.get('search') || queryUrl.searchParams.get('q');
      if (search) {
        const q = search.toLowerCase();
        list = list.filter(a => (a.title && a.title.toLowerCase().includes(q)) || (a.notes && a.notes.toLowerCase().includes(q)));
      }

      const status = queryUrl.searchParams.get('status');
      if (status) {
        list = list.filter(a => a.status && a.status.toLowerCase() === status.toLowerCase());
      }

      const calId = queryUrl.searchParams.get('calendarId') || queryUrl.searchParams.get('calendar_id');
      if (calId) {
        list = list.filter(a => a.calendarId === calId);
      }

      const cId = queryUrl.searchParams.get('contactId') || queryUrl.searchParams.get('contact_id');
      if (cId) {
        list = list.filter(a => a.contactId === cId);
      }

      const total = list.length;
      const page = Math.max(1, Number(queryUrl.searchParams.get('page')) || 1);
      const limit = Math.min(200, Math.max(1, Number(queryUrl.searchParams.get('limit')) || 25));
      const startIdx = (page - 1) * limit;
      const pageData = list.slice(startIdx, startIdx + limit);
      const totalPages = Math.ceil(total / limit);

      sendJson(res, 200, {
        data: pageData,
        appointments: pageData,
        pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
      });
      return true;
    }

    // GET /api/crm/appointments/:id
    if (method === 'GET' && recordId) {
      if (pgPool) {
        try {
          const appt = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.getAppointmentById(tx, recordId);
          });
          if (!appt) {
            sendJson(res, 404, { error: 'Appointment not found' });
            return true;
          }
          sendJson(res, 200, appt);
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error getting appointment from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to retrieve appointment', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      const appt = (state?.records?.appointments || []).find(
        a => a.id === recordId && a.agencyId === agency.id && (!a.locationId || !activeLocation || a.locationId === activeLocation.id)
      );
      if (!appt) {
        sendJson(res, 404, { error: 'Appointment not found' });
        return true;
      }
      sendJson(res, 200, appt);
      return true;
    }

    // POST /api/crm/appointments
    if (method === 'POST') {
      const body = await readBody(req);
      delete body.id;
      delete body.agencyId;
      delete body.locationId;

      if (pgPool) {
        try {
          const created = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.createAppointment(tx, body);
          });
          if (auditLog) auditLog('crm.appointments.created', actor, { id: created.id });
          if (broadcast) broadcast('crm.appointments.created', created);
          sendJson(res, 201, created);
        } catch (err) {
          if (err.code === '23P01' || err.status === 409) {
            sendJson(res, 409, {
              error: 'Cannot book: the selected time slot conflicts with an existing appointment.',
              code: 'SLOT_CONFLICT'
            });
            return true;
          }
          console.error('[SCHEDULING-ROUTER] Error creating appointment in PostgreSQL:', err);
          sendJson(res, 400, { error: err.message || 'Failed to create appointment', code: 'CREATE_FAILED' });
        }
        return true;
      }

      // In-memory fallback
      const startsAt = body.startsAt || body.starts_at;
      const endsAt = body.endsAt || body.ends_at;
      const calId = body.calendarId || body.calendar_id;

      if (!calId || !startsAt || !endsAt) {
        sendJson(res, 400, { error: 'calendarId, startsAt, and endsAt are required' });
        return true;
      }

      // In-memory overlap check
      const sStart = new Date(startsAt).getTime();
      const sEnd = new Date(endsAt).getTime();
      const conflict = (state?.records?.appointments || []).find(
        a => a.calendarId === calId &&
          a.status !== 'cancelled' &&
          Math.max(sStart, new Date(a.startsAt).getTime()) < Math.min(sEnd, new Date(a.endsAt).getTime())
      );
      if (conflict) {
        sendJson(res, 409, {
          error: 'Cannot book: the selected time slot conflicts with an existing appointment.',
          code: 'SLOT_CONFLICT'
        });
        return true;
      }

      const assignedId = randomUUID();
      const newAppt = {
        id: assignedId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        calendarId: calId,
        contactId: body.contactId || body.contact_id || null,
        title: body.title || 'New Appointment',
        startsAt,
        endsAt,
        status: body.status || 'confirmed',
        assignedTo: body.assignedTo || body.assigned_to || null,
        notes: body.notes || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.appointments = state.records.appointments || [];
      state.records.appointments.push(newAppt);
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('appointments', 'create', newAppt, agency.id);
      }
      if (auditLog) auditLog('crm.appointments.created', actor, { id: newAppt.id });
      if (broadcast) broadcast('crm.appointments.created', newAppt);

      sendJson(res, 201, newAppt);
      return true;
    }

    // PUT /api/crm/appointments/:id
    if (method === 'PUT' && recordId) {
      const body = await readBody(req);
      delete body.id;
      delete body.agencyId;
      delete body.locationId;

      if (pgPool) {
        try {
          const updated = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.updateAppointment(tx, recordId, body);
          });
          if (!updated) {
            sendJson(res, 404, { error: 'Appointment not found' });
            return true;
          }
          if (auditLog) auditLog('crm.appointments.updated', actor, { id: recordId });
          if (broadcast) broadcast('crm.appointments.updated', updated);
          sendJson(res, 200, updated);
        } catch (err) {
          if (err.code === '23P01' || err.status === 409) {
            sendJson(res, 409, {
              error: 'Cannot reschedule: the selected time slot conflicts with an existing appointment.',
              code: 'SLOT_CONFLICT'
            });
            return true;
          }
          console.error('[SCHEDULING-ROUTER] Error updating appointment in PostgreSQL:', err);
          sendJson(res, 400, { error: err.message || 'Failed to update appointment', code: 'UPDATE_FAILED' });
        }
        return true;
      }

      // In-memory fallback
      state.records.appointments = state.records.appointments || [];
      const idx = state.records.appointments.findIndex(
        a => a.id === recordId && a.agencyId === agency.id && (!a.locationId || !activeLocation || a.locationId === activeLocation.id)
      );
      if (idx === -1) {
        sendJson(res, 404, { error: 'Appointment not found' });
        return true;
      }

      const current = state.records.appointments[idx];
      const newStartsAt = body.startsAt || body.starts_at || current.startsAt;
      const newEndsAt = body.endsAt || body.ends_at || current.endsAt;
      const newStatus = body.status || current.status;

      if (newStatus !== 'cancelled' && (body.startsAt || body.endsAt)) {
        const sStart = new Date(newStartsAt).getTime();
        const sEnd = new Date(newEndsAt).getTime();
        const conflict = state.records.appointments.find(
          a => a.id !== recordId &&
            a.calendarId === current.calendarId &&
            a.status !== 'cancelled' &&
            Math.max(sStart, new Date(a.startsAt).getTime()) < Math.min(sEnd, new Date(a.endsAt).getTime())
        );
        if (conflict) {
          sendJson(res, 409, {
            error: 'Cannot reschedule: the selected time slot conflicts with an existing appointment.',
            code: 'SLOT_CONFLICT'
          });
          return true;
        }
      }

      const updated = {
        ...current,
        ...body,
        id: recordId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        updatedAt: new Date().toISOString()
      };
      state.records.appointments[idx] = updated;
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('appointments', 'update', updated, agency.id);
      }
      if (auditLog) auditLog('crm.appointments.updated', actor, { id: recordId });
      if (broadcast) broadcast('crm.appointments.updated', updated);

      sendJson(res, 200, updated);
      return true;
    }

    // DELETE /api/crm/appointments/:id
    if (method === 'DELETE' && recordId) {
      if (pgPool) {
        try {
          const ok = await runInTenantTx(pgPool, tenantCtx, async (tx) => {
            return schedulingRepo.deleteAppointment(tx, recordId);
          });
          if (!ok) {
            sendJson(res, 404, { error: 'Appointment not found' });
            return true;
          }
          if (auditLog) auditLog('crm.appointments.deleted', actor, { id: recordId });
          if (broadcast) broadcast('crm.appointments.deleted', { id: recordId });
          sendJson(res, 200, { success: true });
        } catch (err) {
          console.error('[SCHEDULING-ROUTER] Error deleting appointment from PostgreSQL:', err);
          sendJson(res, 500, { error: 'Failed to delete appointment', code: 'INTERNAL_ERROR' });
        }
        return true;
      }

      // In-memory fallback
      state.records.appointments = state.records.appointments || [];
      const idx = state.records.appointments.findIndex(
        a => a.id === recordId && a.agencyId === agency.id && (!a.locationId || !activeLocation || a.locationId === activeLocation.id)
      );
      if (idx === -1) {
        sendJson(res, 404, { error: 'Appointment not found' });
        return true;
      }

      state.records.appointments.splice(idx, 1);
      await saveState();

      if (syncRelationalWrite) {
        await syncRelationalWrite('appointments', 'delete', { id: recordId }, agency.id);
      }
      if (auditLog) auditLog('crm.appointments.deleted', actor, { id: recordId });
      if (broadcast) broadcast('crm.appointments.deleted', { id: recordId });

      sendJson(res, 200, { success: true });
      return true;
    }
  }

  return false;
}
