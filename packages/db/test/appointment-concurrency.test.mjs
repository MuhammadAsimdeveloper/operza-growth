import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Appointment Concurrency & PostgreSQL GiST Exclusion Constraint', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_concurrency_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: dbUrl, max: 25 });

  t.after(async () => {
    await pool.end();
    await pgServer.stop();
    pgServer.cleanupDataDir();
  });

  // 1. Run all migrations in sequence
  await t.test('1. Apply all database migrations', async () => {
    await pool.query(`
      CREATE EXTENSION IF NOT EXISTS btree_gist;
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
      DO $$ BEGIN
        IF NOT pg_has_role(current_user, 'operza_auth_definer', 'MEMBER') THEN
          EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
        END IF;
      END $$;
    `);

    const files = (await readdir(migrationsDir))
      .filter(f => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
      .sort();

    await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now());');

    for (const file of files) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const applied = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
        if (!applied.rowCount) {
          const sql = await readFile(path.join(migrationsDir, file), 'utf8');
          await client.query(sql);
          await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${file} failed: ${err.message}`);
      } finally {
        client.release();
      }
    }
  });

  // Test fixtures setup
  const agencyA = '11111111-1111-4111-8111-111111111111';
  const locationA = '22222222-2222-4222-8222-222222222222';
  const calendarA1 = '33333333-3333-4333-8333-333333333333';
  const calendarA2 = '44444444-4444-4444-8444-444444444444';

  const agencyB = '55555555-5555-4555-8555-555555555555';
  const locationB = '66666666-6666-4666-8666-666666666666';
  const calendarB1 = '77777777-7777-4777-8777-777777777777';

  await t.test('2. Seed tenant calendars and locations', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Seed agencies and locations
      await client.query(`
        INSERT INTO agencies (id, name, slug) VALUES
          ($1, 'Agency Alpha', 'agency-alpha'),
          ($2, 'Agency Beta', 'agency-beta')
        ON CONFLICT (id) DO NOTHING;
      `, [agencyA, agencyB]);

      await client.query(`
        INSERT INTO locations (id, agency_id, name) VALUES
          ($1, $2, 'Location A'),
          ($3, $4, 'Location B')
        ON CONFLICT (agency_id, id) DO NOTHING;
      `, [locationA, agencyA, locationB, agencyB]);

      // Seed calendars
      await client.query(`
        INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min) VALUES
          ($1, $2, $3, 'Strategy Call', 'strategy-call', 30),
          ($4, $2, $3, 'VIP Consult', 'vip-consult', 60),
          ($5, $6, $7, 'Beta Discovery', 'beta-discovery', 30)
        ON CONFLICT (agency_id, location_id, id) DO NOTHING;
      `, [calendarA1, agencyA, locationA, calendarA2, calendarB1, agencyB, locationB]);

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // Helper to insert appointment inside explicit transaction
  async function bookAppointment({
    id = crypto.randomUUID(),
    agencyId = agencyA,
    locationId = locationA,
    calendarId = calendarA1,
    title = 'Test Booking',
    startsAt,
    endsAt,
    status = 'confirmed'
  }) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true)", [agencyId]);
      await client.query("SELECT set_config('app.location_id', $1, true)", [locationId]);

      const res = await client.query(`
        INSERT INTO appointments (
          id, agency_id, location_id, calendar_id, title, starts_at, ends_at, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, status, starts_at, ends_at;
      `, [id, agencyId, locationId, calendarId, title, startsAt, endsAt, status]);

      await client.query('COMMIT');
      return { success: true, appointment: res.rows[0] };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return { success: false, error: err };
    } finally {
      client.release();
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // Test Cases: Scenarios 1 - 15
  // ══════════════════════════════════════════════════════════════════════

  await t.test('Scenario 1: Two simultaneous inserts for exact same slot -> exactly ONE succeeds', async () => {
    const slotStart = '2026-12-01T10:00:00.000Z';
    const slotEnd = '2026-12-01T10:30:00.000Z';

    const [res1, res2] = await Promise.all([
      bookAppointment({ startsAt: slotStart, endsAt: slotEnd, title: 'Client 1' }),
      bookAppointment({ startsAt: slotStart, endsAt: slotEnd, title: 'Client 2' })
    ]);

    const successes = [res1, res2].filter(r => r.success);
    const failures = [res1, res2].filter(r => !r.success);

    assert.equal(successes.length, 1, 'Exactly one concurrent reservation must succeed');
    assert.equal(failures.length, 1, 'The other concurrent reservation must fail');
    assert.equal(failures[0].error.code, '23P01', 'Error code must be PostgreSQL exclusion_violation (23P01)');
  });

  await t.test('Scenario 2: 20 simultaneous requests for overlapping slot -> exactly ONE succeeds', async () => {
    const promises = Array.from({ length: 20 }, (_, i) =>
      bookAppointment({
        startsAt: '2026-12-01T14:00:00.000Z',
        endsAt: '2026-12-01T14:30:00.000Z',
        title: `Contender ${i}`
      })
    );

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    assert.equal(successCount, 1, 'Under 20 concurrent requests, exactly 1 must succeed');
    assert.equal(failCount, 19, 'Under 20 concurrent requests, exactly 19 must be rejected');
    for (const f of results.filter(r => !r.success)) {
      assert.ok(f.error.code === '23P01' || f.error.code === '40P01', `Expected concurrency rejection code (23P01 or 40P01), got ${f.error.code}`);
    }
  });

  await t.test('Scenario 4: Overlapping interval (starts before previous ends) is rejected', async () => {
    // Occupies 11:00 to 11:30
    const first = await bookAppointment({
      startsAt: '2026-12-01T11:00:00.000Z',
      endsAt: '2026-12-01T11:30:00.000Z',
      title: 'First'
    });
    assert.equal(first.success, true);

    // Overlaps 11:15 to 11:45
    const overlap = await bookAppointment({
      startsAt: '2026-12-01T11:15:00.000Z',
      endsAt: '2026-12-01T11:45:00.000Z',
      title: 'Overlapping'
    });
    assert.equal(overlap.success, false);
    assert.equal(overlap.error.code, '23P01');
  });

  await t.test('Scenario 5: Contained interval (within existing appointment) is rejected', async () => {
    // Occupies 15:00 to 16:00 (1 hour)
    const container = await bookAppointment({
      startsAt: '2026-12-01T15:00:00.000Z',
      endsAt: '2026-12-01T16:00:00.000Z',
      title: 'Long Block'
    });
    assert.equal(container.success, true);

    // Inside 15:15 to 15:45
    const inside = await bookAppointment({
      startsAt: '2026-12-01T15:15:00.000Z',
      endsAt: '2026-12-01T15:45:00.000Z',
      title: 'Contained Block'
    });
    assert.equal(inside.success, false);
    assert.equal(inside.error.code, '23P01');
  });

  await t.test('Scenario 6: Identical boundaries are rejected', async () => {
    const resA = await bookAppointment({
      startsAt: '2026-12-01T16:00:00.000Z',
      endsAt: '2026-12-01T16:30:00.000Z',
      title: 'Identical A'
    });
    assert.equal(resA.success, true);

    const resB = await bookAppointment({
      startsAt: '2026-12-01T16:00:00.000Z',
      endsAt: '2026-12-01T16:30:00.000Z',
      title: 'Identical B'
    });
    assert.equal(resB.success, false);
    assert.equal(resB.error.code, '23P01');
  });

  await t.test('Scenario 7: Adjacent intervals [start1, end1) and [end1, end2) MUST SUCCEED', async () => {
    // 09:00 to 09:30
    const slot1 = await bookAppointment({
      startsAt: '2026-12-02T09:00:00.000Z',
      endsAt: '2026-12-02T09:30:00.000Z',
      title: 'Adjacent 1'
    });
    assert.equal(slot1.success, true);

    // 09:30 to 10:00 (Starts exactly when slot1 ends)
    const slot2 = await bookAppointment({
      startsAt: '2026-12-02T09:30:00.000Z',
      endsAt: '2026-12-02T10:00:00.000Z',
      title: 'Adjacent 2'
    });
    assert.equal(slot2.success, true, 'Adjacent appointments with half-open intervals [) must both succeed');
  });

  await t.test('Scenario 8: Different resources (calendars) at identical time MUST BOTH SUCCEED', async () => {
    const identicalTime = '2026-12-02T11:00:00.000Z';
    const identicalEnd = '2026-12-02T11:30:00.000Z';

    const cal1 = await bookAppointment({
      calendarId: calendarA1,
      startsAt: identicalTime,
      endsAt: identicalEnd,
      title: 'Calendar 1'
    });
    const cal2 = await bookAppointment({
      calendarId: calendarA2,
      startsAt: identicalTime,
      endsAt: identicalEnd,
      title: 'Calendar 2'
    });

    assert.equal(cal1.success, true);
    assert.equal(cal2.success, true, 'Different calendars in same agency/location can be booked concurrently');
  });

  await t.test('Scenario 9: Different agencies at identical time MUST BOTH SUCCEED', async () => {
    const time = '2026-12-02T13:00:00.000Z';
    const end = '2026-12-02T13:30:00.000Z';

    const agencyABooking = await bookAppointment({
      agencyId: agencyA,
      locationId: locationA,
      calendarId: calendarA1,
      startsAt: time,
      endsAt: end,
      title: 'Agency A Booking'
    });

    const agencyBBooking = await bookAppointment({
      agencyId: agencyB,
      locationId: locationB,
      calendarId: calendarB1,
      startsAt: time,
      endsAt: end,
      title: 'Agency B Booking'
    });

    assert.equal(agencyABooking.success, true);
    assert.equal(agencyBBooking.success, true, 'Different agencies can book same timestamp without interference');
  });

  await t.test('Scenario 10: Cancellation releases the slot -> new booking MUST SUCCEED', async () => {
    const slotTime = '2026-12-02T15:00:00.000Z';
    const slotEnd = '2026-12-02T15:30:00.000Z';
    const apptId = crypto.randomUUID();

    // 1. Initial confirmed booking
    const initial = await bookAppointment({
      id: apptId,
      startsAt: slotTime,
      endsAt: slotEnd,
      title: 'Will Cancel'
    });
    assert.equal(initial.success, true);

    // 2. Cancel the appointment
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true)", [agencyA]);
      await client.query("SELECT set_config('app.location_id', $1, true)", [locationA]);
      await client.query("UPDATE appointments SET status = 'cancelled' WHERE id = $1", [apptId]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    // 3. New booking for the same slot must now succeed
    const replacement = await bookAppointment({
      startsAt: slotTime,
      endsAt: slotEnd,
      title: 'Replacement Customer'
    });
    assert.equal(replacement.success, true, 'Cancelled appointments must release their exclusion slot');
  });

  await t.test('Scenario 11 & 12: Rescheduling into occupied slot fails; into free slot succeeds', async () => {
    const apptToMove = crypto.randomUUID();
    const existingOccupied = crypto.randomUUID();

    // Appointment 1 at 17:00
    await bookAppointment({
      id: apptToMove,
      startsAt: '2026-12-02T17:00:00.000Z',
      endsAt: '2026-12-02T17:30:00.000Z',
      title: 'Moving Appt'
    });

    // Appointment 2 at 18:00
    await bookAppointment({
      id: existingOccupied,
      startsAt: '2026-12-02T18:00:00.000Z',
      endsAt: '2026-12-02T18:30:00.000Z',
      title: 'Stationary Appt'
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true)", [agencyA]);
      await client.query("SELECT set_config('app.location_id', $1, true)", [locationA]);

      // Attempt to reschedule Appt 1 into occupied 18:00 slot -> must fail with 23P01
      let failedAsExpected = false;
      try {
        await client.query(`
          UPDATE appointments
          SET starts_at = '2026-12-02T18:00:00.000Z', ends_at = '2026-12-02T18:30:00.000Z'
          WHERE id = $1;
        `, [apptToMove]);
      } catch (err) {
        failedAsExpected = (err.code === '23P01');
      }
      assert.equal(failedAsExpected, true, 'Rescheduling into occupied slot must violate exclusion constraint');
      await client.query('ROLLBACK');

      // Reschedule Appt 1 into free 19:00 slot -> must succeed
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true)", [agencyA]);
      await client.query("SELECT set_config('app.location_id', $1, true)", [locationA]);
      const updateRes = await client.query(`
        UPDATE appointments
        SET starts_at = '2026-12-02T19:00:00.000Z', ends_at = '2026-12-02T19:30:00.000Z'
        WHERE id = $1
        RETURNING id, starts_at;
      `, [apptToMove]);
      await client.query('COMMIT');
      assert.equal(updateRes.rowCount, 1, 'Rescheduling into free slot must succeed');
    } finally {
      client.release();
    }
  });

  await t.test('Scenario 14: Failed transaction leaves no ghost rows', async () => {
    const slot = '2026-12-03T10:00:00.000Z';
    const end = '2026-12-03T10:30:00.000Z';

    const first = await bookAppointment({ startsAt: slot, endsAt: end, title: 'Valid' });
    assert.equal(first.success, true);

    // Conflicting booking
    const conflict = await bookAppointment({ startsAt: slot, endsAt: end, title: 'Ghost Attempt' });
    assert.equal(conflict.success, false);

    // Verify row count in database
    const countRes = await pool.query(
      'SELECT count(*)::int as count FROM appointments WHERE calendar_id = $1 AND starts_at = $2',
      [calendarA1, slot]
    );
    assert.equal(countRes.rows[0].count, 1, 'Database must contain exactly 1 booking for this slot');
  });

  await t.test('Scenario 15: Time-range semantic checks', async () => {
    // starts_at must be before ends_at
    const backwards = await bookAppointment({
      startsAt: '2026-12-03T12:30:00.000Z',
      endsAt: '2026-12-03T12:00:00.000Z',
      title: 'Backwards Time'
    });
    assert.equal(backwards.success, false, 'ends_at <= starts_at must be rejected');
  });
});
