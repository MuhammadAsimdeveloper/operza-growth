import test from 'node:test';
import assert from 'node:assert/strict';
import { runInTenantTx } from '../lib/tenant-tx.mjs';
import { createSchedulingRepository } from '../lib/scheduling-repository.mjs';

function createInMemoryStoragePool() {
  const calendars = []; // { id, agency_id, location_id, name, slug, color, duration_min, availability, round_robin, description, status, created_at, updated_at }
  const appointments = []; // { id, agency_id, location_id, calendar_id, contact_id, title, starts_at, ends_at, status, assigned_to, notes, external_event_id, created_at, updated_at }

  return {
    calendars,
    appointments,
    async connect() {
      let currentAgencyId = null;
      let currentLocationId = null;
      let currentUserId = null;
      let inTx = false;

      return {
        async query(sql, params = []) {
          const normSql = sql.replace(/\s+/g, ' ').trim();

          if (normSql === 'BEGIN') {
            inTx = true;
            return { rows: [], rowCount: 0 };
          }
          if (normSql === 'COMMIT' || normSql === 'ROLLBACK') {
            inTx = false;
            currentAgencyId = null;
            currentLocationId = null;
            currentUserId = null;
            return { rows: [], rowCount: 0 };
          }
          if (normSql.includes("set_config('app.agency_id'")) {
            currentAgencyId = params[0];
            currentLocationId = params[1];
            currentUserId = params[2];
            return { rows: [], rowCount: 0 };
          }

          // -------------------------------------------------------------
          // CALENDARS QUERIES
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO calendars')) {
            const [
              id, agencyId, locationId, name, slug, color, durationMin,
              availabilityStr, roundRobin, description, status, createdAt, updatedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO calendars');
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              name,
              slug,
              color: color || '#4f46e5',
              duration_min: Number(durationMin) || 30,
              availability: typeof availabilityStr === 'string' ? JSON.parse(availabilityStr) : (availabilityStr || {}),
              round_robin: Boolean(roundRobin),
              description: description || null,
              status: status || 'active',
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            calendars.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT count(*) as count FROM calendars') || normSql.startsWith('SELECT count(*)::int as count FROM calendars')) {
            const agencyId = params[0];
            const locationId = params[1];
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [{ count: 0 }], rowCount: 1 };
            }
            const filtered = calendars.filter(c => c.agency_id === agencyId && c.location_id === locationId);
            return { rows: [{ count: filtered.length }], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM calendars WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = calendars.find(c => c.agency_id === agencyId && c.location_id === locationId && c.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM calendars WHERE agency_id = $1 AND location_id = $2 AND (id::text = $3 OR slug = $3)')) {
            const [agencyId, locationId, idOrSlug] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = calendars.find(c => c.agency_id === agencyId && c.location_id === locationId && (c.id === idOrSlug || c.slug === idOrSlug));
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM calendars WHERE (id::text = $1 OR slug = $1) AND status != \'inactive\'') ||
              normSql.includes('lookup_public_calendar')) {
            const idOrSlug = params[0];
            const match = calendars.find(c => (c.id === idOrSlug || c.slug === idOrSlug) && c.status !== 'inactive');
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM calendars WHERE agency_id = $1 AND location_id = $2')) {
            const [agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            let res = calendars.filter(c => c.agency_id === agencyId && c.location_id === locationId);
            return { rows: res, rowCount: res.length };
          }

          if (normSql.startsWith('UPDATE calendars SET')) {
            const agencyId = params[params.length - 2];
            const id = params[params.length - 1];
            if (agencyId !== currentAgencyId) {
              return { rows: [], rowCount: 0 };
            }
            const match = calendars.find(c => c.agency_id === agencyId && c.location_id === currentLocationId && c.id === id);
            if (!match) return { rows: [], rowCount: 0 };
            return { rows: [match], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM calendars WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const idx = calendars.findIndex(c => c.agency_id === agencyId && c.location_id === locationId && c.id === id);
            if (idx >= 0) {
              calendars.splice(idx, 1);
              return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }

          // -------------------------------------------------------------
          // APPOINTMENTS QUERIES & GiST EXCLUSION SIMULATION
          // -------------------------------------------------------------
          if (normSql.startsWith('INSERT INTO appointments')) {
            const [
              id, agencyId, locationId, calendarId, contactId,
              title, startsAt, endsAt, status, assignedTo, notes,
              externalEventId, createdAt, updatedAt
            ] = params;

            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              throw new Error('RLS check violation on INSERT INTO appointments');
            }

            const sStart = new Date(startsAt).getTime();
            const sEnd = new Date(endsAt).getTime();
            const apptStatus = status || 'confirmed';

            // Simulate GiST constraint: exclude overlapping active appointments
            // interval: [starts_at, ends_at) half-open
            // condition: WHERE status != 'cancelled'
            if (apptStatus !== 'cancelled') {
              const conflict = appointments.find(a =>
                a.agency_id === agencyId &&
                a.location_id === locationId &&
                a.calendar_id === calendarId &&
                a.status !== 'cancelled' &&
                Math.max(sStart, new Date(a.starts_at).getTime()) < Math.min(sEnd, new Date(a.ends_at).getTime())
              );
              if (conflict) {
                const err = new Error('conflicting key value violates exclusion constraint "exclude_overlapping_active_appointments"');
                err.code = '23P01';
                throw err;
              }
            }

            const row = {
              id,
              agency_id: agencyId,
              location_id: locationId,
              calendar_id: calendarId,
              contact_id: contactId || null,
              title,
              starts_at: new Date(startsAt),
              ends_at: new Date(endsAt),
              status: apptStatus,
              assigned_to: assignedTo || null,
              notes: notes || null,
              external_event_id: externalEventId || null,
              created_at: createdAt ? new Date(createdAt) : new Date(),
              updated_at: updatedAt ? new Date(updatedAt) : new Date()
            };
            appointments.push(row);
            return { rows: [row], rowCount: 1 };
          }

          if (normSql.startsWith('SELECT * FROM appointments WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const match = appointments.find(a => a.agency_id === agencyId && a.location_id === locationId && a.id === id);
            return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
          }

          if (normSql.startsWith('SELECT * FROM appointments WHERE agency_id = $1 AND location_id = $2')) {
            const [agencyId, locationId] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            let res = appointments.filter(a => a.agency_id === agencyId && a.location_id === locationId);
            return { rows: res, rowCount: res.length };
          }

          if (normSql.startsWith('SELECT starts_at, ends_at FROM appointments WHERE calendar_id = $1') ||
              normSql.startsWith('SELECT starts_at FROM appointments WHERE calendar_id = $1')) {
            const calendarId = params[0];
            const res = appointments.filter(a => a.calendar_id === calendarId && a.status !== 'cancelled');
            return { rows: res, rowCount: res.length };
          }

          if (normSql.startsWith('UPDATE appointments SET')) {
            const id = params[params.length - 1];
            const agencyId = currentAgencyId;
            const locationId = currentLocationId;

            const match = appointments.find(a => a.agency_id === agencyId && a.location_id === locationId && a.id === id);
            if (!match) return { rows: [], rowCount: 0 };

            // Parse SET clauses to find which parameter maps to which column
            const setPart = normSql.slice('UPDATE appointments SET'.length, normSql.indexOf('WHERE')).trim();
            const clauses = setPart.split(',').map(s => s.trim());

            for (const clause of clauses) {
              const m = clause.match(/^([a-z_]+)\s*=\s*\$(\d+)$/);
              if (m) {
                const col = m[1];
                const pIdx = parseInt(m[2], 10) - 1;
                const val = params[pIdx];
                if (col === 'starts_at') match.starts_at = new Date(val);
                if (col === 'ends_at') match.ends_at = new Date(val);
                if (col === 'status') match.status = val;
                if (col === 'title') match.title = val;
                if (col === 'notes') match.notes = val;
                if (col === 'assigned_to') match.assigned_to = val;
                if (col === 'external_event_id') match.external_event_id = val;
              }
            }
            match.updated_at = new Date();

            if (match.status !== 'cancelled') {
              const sStart = match.starts_at.getTime();
              const sEnd = match.ends_at.getTime();
              const conflict = appointments.find(a =>
                a.id !== id &&
                a.agency_id === agencyId &&
                a.location_id === locationId &&
                a.calendar_id === match.calendar_id &&
                a.status !== 'cancelled' &&
                Math.max(sStart, new Date(a.starts_at).getTime()) < Math.min(sEnd, new Date(a.ends_at).getTime())
              );
              if (conflict) {
                const err = new Error('conflicting key value violates exclusion constraint "exclude_overlapping_active_appointments"');
                err.code = '23P01';
                throw err;
              }
            }

            return { rows: [match], rowCount: 1 };
          }

          if (normSql.startsWith('DELETE FROM appointments WHERE agency_id = $1 AND location_id = $2 AND id = $3')) {
            const [agencyId, locationId, id] = params;
            if (agencyId !== currentAgencyId || locationId !== currentLocationId) {
              return { rows: [], rowCount: 0 };
            }
            const idx = appointments.findIndex(a => a.agency_id === agencyId && a.location_id === locationId && a.id === id);
            if (idx >= 0) {
              appointments.splice(idx, 1);
              return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 0 };
          }

          return { rows: [], rowCount: 0 };
        },
        release() {}
      };
    }
  };
}

test('SchedulingRepository — Full Lifecycle under TenantTx (Calendars & Appointments)', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createSchedulingRepository();

  const agencyId = '11111111-1111-4111-8111-111111111111';
  const locationId = '22222222-2222-4222-8222-222222222222';
  const userId = '33333333-3333-4333-8333-333333333333';

  let calendarId;

  // 1. Create calendar
  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    const calendar = await repo.createCalendar(tx, {
      name: 'Strategy Session',
      slug: 'strategy-session',
      durationMin: 30,
      description: 'Discovery call with growth advisor'
    });

    assert.ok(calendar.id, 'Calendar should have an ID');
    assert.equal(calendar.name, 'Strategy Session');
    assert.equal(calendar.slug, 'strategy-session');
    assert.equal(calendar.durationMin, 30);
    assert.equal(calendar.status, 'active');
    calendarId = calendar.id;
  });

  // 2. Read calendar by ID and Slug
  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    const byId = await repo.getCalendarById(tx, calendarId);
    assert.ok(byId, 'Should retrieve calendar by ID');
    assert.equal(byId.id, calendarId);

    const bySlug = await repo.getCalendarBySlug(tx, 'strategy-session');
    assert.ok(bySlug, 'Should retrieve calendar by slug');
    assert.equal(bySlug.id, calendarId);
  });

  // 3. Create appointment
  let appointmentId;
  const startsAt = '2026-12-01T10:00:00.000Z';
  const endsAt = '2026-12-01T10:30:00.000Z';

  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    const appt = await repo.createAppointment(tx, {
      calendarId,
      title: 'Strategy with Marcus',
      startsAt,
      endsAt,
      status: 'confirmed',
      notes: 'Initial strategy consult'
    });

    assert.ok(appt.id);
    assert.equal(appt.calendarId, calendarId);
    assert.equal(appt.status, 'confirmed');
    appointmentId = appt.id;
  });

  // 4. Overlapping appointment on same calendar should trigger GiST conflict (23P01)
  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    await assert.rejects(
      async () => {
        await repo.createAppointment(tx, {
          calendarId,
          title: 'Conflicting Booking',
          startsAt: '2026-12-01T10:15:00.000Z',
          endsAt: '2026-12-01T10:45:00.000Z',
          status: 'confirmed'
        });
      },
      (err) => {
        return err.code === '23P01' || err.message?.includes('exclude_overlapping_active_appointments');
      },
      'Should reject overlapping appointment with GiST exclusion constraint violation'
    );
  });

  // 5. Adjacent appointment ([10:30, 11:00)) should succeed on half-open interval
  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    const adjacent = await repo.createAppointment(tx, {
      calendarId,
      title: 'Adjacent Appointment',
      startsAt: '2026-12-01T10:30:00.000Z',
      endsAt: '2026-12-01T11:00:00.000Z',
      status: 'confirmed'
    });
    assert.ok(adjacent.id);
    assert.equal(adjacent.startsAt, '2026-12-01T10:30:00.000Z');
  });

  // 6. Cancellation should release the slot
  await runInTenantTx(pool, { agencyId, locationId, userId }, async (tx) => {
    const cancelled = await repo.cancelAppointment(tx, appointmentId);
    assert.equal(cancelled.status, 'cancelled');

    // Now re-booking 10:00 - 10:30 must succeed because active predicate excludes cancelled
    const rebooked = await repo.createAppointment(tx, {
      calendarId,
      title: 'Rebooked Slot',
      startsAt,
      endsAt,
      status: 'confirmed'
    });
    assert.ok(rebooked.id);
    assert.equal(rebooked.status, 'confirmed');
  });
});

test('SchedulingRepository — Strict Multi-Tenant Isolation', async () => {
  const pool = createInMemoryStoragePool();
  const repo = createSchedulingRepository();

  const tenantA = {
    agencyId: '11111111-1111-4111-8111-111111111111',
    locationId: '22222222-2222-4222-8222-222222222222',
    userId: '33333333-3333-4333-8333-333333333333'
  };

  const tenantB = {
    agencyId: '99999999-9999-4999-8999-999999999999',
    locationId: '88888888-8888-4888-8888-888888888888',
    userId: '77777777-7777-4777-8777-777777777777'
  };

  let tenantACalendarId;
  let tenantAApptId;

  // Tenant A creates calendar and appointment
  await runInTenantTx(pool, tenantA, async (tx) => {
    const cal = await repo.createCalendar(tx, {
      name: 'Tenant A VIP Calendar',
      slug: 'tenant-a-vip'
    });
    tenantACalendarId = cal.id;

    const appt = await repo.createAppointment(tx, {
      calendarId: cal.id,
      title: 'Tenant A Secret Call',
      startsAt: '2026-12-05T14:00:00.000Z',
      endsAt: '2026-12-05T14:30:00.000Z'
    });
    tenantAApptId = appt.id;
  });

  // Tenant B cannot see Tenant A's calendar
  await runInTenantTx(pool, tenantB, async (tx) => {
    const cal = await repo.getCalendarById(tx, tenantACalendarId);
    assert.equal(cal, null, 'Tenant B must not see Tenant A calendar');

    const appt = await repo.getAppointmentById(tx, tenantAApptId);
    assert.equal(appt, null, 'Tenant B must not see Tenant A appointment');

    const calList = await repo.listCalendars(tx);
    assert.equal(calList.calendars.length, 0);

    const apptList = await repo.listAppointments(tx);
    assert.equal(apptList.appointments.length, 0);
  });
});
