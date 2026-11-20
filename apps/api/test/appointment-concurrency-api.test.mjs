import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IsolatedTestPostgres } from '../../../packages/db/lib/test-postgres-server.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

const PORT_P1 = 4301;
const PORT_P2 = 4302;
const BASE_P1 = `http://127.0.0.1:${PORT_P1}`;
const BASE_P2 = `http://127.0.0.1:${PORT_P2}`;
const STORE_P1 = './scratch/store_api_concurrency_p1.json';
const STORE_P2 = './scratch/store_api_concurrency_p2.json';

try { rmSync(path.join(root, 'apps/api', STORE_P1), { force: true }); } catch {}
try { rmSync(path.join(root, 'apps/api', STORE_P2), { force: true }); } catch {}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

test('Multi-Process Appointment Booking Concurrency (Two Independent API Instances)', async (t) => {
  const pgServer = new IsolatedTestPostgres({ port: 5435, dbName: 'operza_multi_proc_test' });
  const dbUrl = await pgServer.start();

  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString: dbUrl, max: 10 });

  let proc1 = null;
  let proc2 = null;

  t.after(async () => {
    if (proc1) proc1.kill('SIGTERM');
    if (proc2) proc2.kill('SIGTERM');
    await sleep(400);
    await pool.end();
    await pgServer.stop();
    try { rmSync(path.join(root, 'apps/api', STORE_P1), { force: true }); } catch {}
    try { rmSync(path.join(root, 'apps/api', STORE_P2), { force: true }); } catch {}
  });

  // 1. Run migrations
  await t.test('1. Apply migrations to shared PostgreSQL database', async () => {
    await pool.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_auth_definer') THEN
          CREATE ROLE operza_auth_definer NOLOGIN NOINHERIT BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_app') THEN
          CREATE ROLE operza_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='operza_worker') THEN
          CREATE ROLE operza_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
        END IF;
      END $$;
      GRANT USAGE, CREATE ON SCHEMA public TO operza_auth_definer;
      DO $$ BEGIN
        EXECUTE format('GRANT operza_auth_definer TO %I', current_user);
      EXCEPTION WHEN OTHERS THEN NULL;
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

  // 2. Start Process 1 and Process 2
  await t.test('2. Start two independent Operza API instances on ports 4301 and 4302', async () => {
    const commonEnv = {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: dbUrl,
      MIGRATION_DATABASE_URL: dbUrl,
      OPERZA_TEST_DATABASE_URL: dbUrl,
      OPERZA_VAULT_KEY: process.env.OPERZA_VAULT_KEY || 'test-vault-key-for-appointment-concurrency-32'
    };

    proc1 = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...commonEnv, PORT: String(PORT_P1), DATA_FILE: STORE_P1 }
    });
    proc1.stderr.on('data', d => console.error('[PROC1 STDERR]', d.toString()));
    proc1.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('ERROR') || msg.includes('Unhandled') || msg.includes('error')) console.error('[PROC1 STDOUT]', msg);
    });

    proc2 = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: { ...commonEnv, PORT: String(PORT_P2), DATA_FILE: STORE_P2 }
    });
    proc2.stderr.on('data', d => console.error('[PROC2 STDERR]', d.toString()));
    proc2.stdout.on('data', d => {
      const msg = d.toString();
      if (msg.includes('ERROR') || msg.includes('Unhandled') || msg.includes('error')) console.error('[PROC2 STDOUT]', msg);
    });

    let p1Up = false, p2Up = false;
    for (let i = 0; i < 40; i++) {
      try {
        const r1 = await fetch(`${BASE_P1}/health`);
        if (r1.ok) p1Up = true;
      } catch {}
      try {
        const r2 = await fetch(`${BASE_P2}/health`);
        if (r2.ok) p2Up = true;
      } catch {}
      if (p1Up && p2Up) break;
      await sleep(250);
    }

    assert.equal(p1Up, true, 'Process 1 must become healthy');
    assert.equal(p2Up, true, 'Process 2 must become healthy');
  });

  // 3. Setup Agency and Calendar on Process 1
  let calendarSlug = '';
  let sessionCookie = '';
  let csrfToken = '';
  let activeApptId = '';
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

  await t.test('3. Setup Agency and Calendar on Process 1', async () => {
    const email = `owner-multiproc-${Date.now()}@agency.test`;
    const signupRes = await fetch(`${BASE_P1}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'MultiProc Founder',
        email,
        password: 'Password123!',
        agencyName: 'MultiProc Agency'
      })
    });
    assert.equal(signupRes.status, 201);

    const cookies = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [signupRes.headers.get('set-cookie')].filter(Boolean);
    sessionCookie = cookies.map(c => c.split(';')[0]).join('; ');
    const csrfMatch = sessionCookie.match(/operza_csrf=([^;]+)/);
    csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]) : '';

    calendarSlug = `shared-cal-${Date.now()}`;
    const calRes = await fetch(`${BASE_P1}/api/crm/calendars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({
        name: 'Shared Multi-Process Calendar',
        slug: calendarSlug,
        durationMin: 30,
        availability: ['10:00', '11:00', '14:00', '15:00'],
        status: 'active'
      })
    });
    assert.equal(calRes.status, 201);
  });

  // 4. Multi-Process Simultaneous Booking Blast
  await t.test('4. Cross-Process Booking: Client A -> Process 1, Client B -> Process 2 for exact same slot', async () => {
    const targetSlot = '10:00';

    // Simultaneously dispatch to two different API servers
    const reqA = fetch(`${BASE_P1}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Alpha',
        email: 'alpha@cross-proc.test',
        date: tomorrow,
        timeSlot: targetSlot,
        notes: 'Sent to Process 1'
      })
    });

    const reqB = fetch(`${BASE_P2}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Beta',
        email: 'beta@cross-proc.test',
        date: tomorrow,
        timeSlot: targetSlot,
        notes: 'Sent to Process 2'
      })
    });

    const [resA, resB] = await Promise.all([reqA, reqB]);
    const statuses = [resA.status, resB.status].sort();

    // The core mission assertion:
    // One must receive 201, the other must receive 409!
    assert.deepEqual(
      statuses,
      [201, 409],
      'CRITICAL MULTI-PROCESS FAILURE: Two independent processes must NEVER both confirm the same booking! Expected [201, 409]'
    );

    const successRes = resA.status === 201 ? resA : resB;
    const conflictRes = resA.status === 409 ? resA : resB;

    const successData = await successRes.json();
    assert.equal(successData.success, true);
    assert.ok(successData.appointment?.id);
    activeApptId = successData.appointment.id;

    const conflictData = await conflictRes.json();
    assert.equal(conflictData.code, 'SLOT_CONFLICT');
    assert.equal(conflictData.error, 'This time slot is no longer available. Please choose another time.');

    // Authoritative verification directly against PostgreSQL
    const dbAppts = await pool.query(
      "SELECT id, starts_at, ends_at, status FROM appointments WHERE starts_at = $1 AND status != 'cancelled'",
      [`${tomorrow}T10:00:00.000Z`]
    );
    assert.equal(dbAppts.rows.length, 1, 'PostgreSQL database must contain EXACTLY ONE active record for 10:00');
    assert.equal(dbAppts.rows[0].id, activeApptId);
  });

  // 5. Subsequent Booking Attempts from Both Processes Receive 409
  await t.test('5. Subsequent booking attempts on booked slot receive HTTP 409 from both instances', async () => {
    const resP1 = await fetch(`${BASE_P1}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Gamma',
        email: 'gamma@cross-proc.test',
        date: tomorrow,
        timeSlot: '10:00'
      })
    });
    assert.equal(resP1.status, 409);
    const bodyP1 = await resP1.json();
    assert.equal(bodyP1.code, 'SLOT_CONFLICT');

    const resP2 = await fetch(`${BASE_P2}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Delta',
        email: 'delta@cross-proc.test',
        date: tomorrow,
        timeSlot: '10:00'
      })
    });
    assert.equal(resP2.status, 409);
    const bodyP2 = await resP2.json();
    assert.equal(bodyP2.code, 'SLOT_CONFLICT');
  });

  // 6. Public Availability Reflection Across Processes
  await t.test('6. Public calendar availability reflects booked slot across both instances', async () => {
    const pubRes1 = await fetch(`${BASE_P1}/api/calendars/public/${calendarSlug}?date=${tomorrow}`);
    assert.equal(pubRes1.status, 200);
    const dataP1 = await pubRes1.json();
    assert.ok(!dataP1.availableSlots.includes('10:00'), 'Process 1 must exclude 10:00 from availableSlots');

    const pubRes2 = await fetch(`${BASE_P2}/api/calendars/public/${calendarSlug}?date=${tomorrow}`);
    assert.equal(pubRes2.status, 200);
    const dataP2 = await pubRes2.json();
    assert.ok(!dataP2.availableSlots.includes('10:00'), 'Process 2 must exclude 10:00 from availableSlots');
  });

  // 7. Cancellation Releases Slot Cross-Process
  await t.test('7. Cancelling appointment on Process 1 releases slot for booking on Process 2', async () => {
    // Cancel appointment via Process 1 CRM endpoint
    const cancelRes = await fetch(`${BASE_P1}/api/crm/appointments/${activeApptId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({ status: 'cancelled' })
    });
    assert.equal(cancelRes.status, 200);

    // Book the released 10:00 slot on Process 2
    const rebookRes = await fetch(`${BASE_P2}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Epsilon',
        email: 'epsilon@cross-proc.test',
        date: tomorrow,
        timeSlot: '10:00',
        notes: 'Rebooked on Process 2 after cancellation'
      })
    });
    assert.equal(rebookRes.status, 201, 'Rebooking cancelled slot on Process 2 must succeed');
    const rebookData = await rebookRes.json();
    assert.equal(rebookData.success, true);
    activeApptId = rebookData.appointment.id;
  });

  // 8. Rescheduling Conflict Enforcement
  await t.test('8. Rescheduling conflict: Attempting to move another appointment into 10:00 is rejected with 409', async () => {
    // Book 11:00 slot on Process 1
    const book11Res = await fetch(`${BASE_P1}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Client Zeta',
        email: 'zeta@cross-proc.test',
        date: tomorrow,
        timeSlot: '11:00'
      })
    });
    assert.equal(book11Res.status, 201);
    const book11Data = await book11Res.json();
    const appt11Id = book11Data.appointment.id;

    // Attempt to reschedule 11:00 appointment into 10:00 (which is held by Client Epsilon)
    const rescheduleRes = await fetch(`${BASE_P1}/api/crm/appointments/${appt11Id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({
        startsAt: `${tomorrow}T10:00:00.000Z`,
        endsAt: `${tomorrow}T10:30:00.000Z`
      })
    });
    assert.equal(rescheduleRes.status, 409, 'Rescheduling into conflicting slot must return 409 Conflict');
    const rescheduleData = await rescheduleRes.json();
    assert.equal(rescheduleData.code, 'SLOT_CONFLICT');
  });
});
