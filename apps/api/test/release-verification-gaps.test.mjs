import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 4007;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const TEST_STORE = './data/test_gap_store.json';

// Ensure clean test store
try {
  rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
} catch {}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('Release Verification Gaps: Workflow Persistence & Concurrent Booking', async (t) => {
  let serverProcess = null;
  let serverExited = false;
  let exitCode = null;

  await t.test('1. Start API Server on isolated test port', async () => {
    serverProcess = spawn('node', ['apps/api/server.mjs'], {
      cwd: root,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_ENV: 'test',
        DATA_FILE: TEST_STORE
      }
    });

    serverProcess.on('exit', (code) => {
      serverExited = true;
      exitCode = code;
    });

    let healthy = false;
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await sleep(250);
    }
    assert.equal(healthy, true, 'API server should be healthy on startup');
  });

  let sessionCookie = '';
  let csrfToken = '';

  await t.test('2. Authenticate admin user for testing', async () => {
    const email = `gap-tester-${Date.now()}@operza-agency.test`;
    const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Gap Auditor',
        email,
        password: 'Password123!',
        agencyName: 'Operza Auditor Agency'
      })
    });
    assert.equal(signupRes.status, 201);

    const cookieHeaders = signupRes.headers.getSetCookie ? signupRes.headers.getSetCookie() : [signupRes.headers.get('set-cookie')].filter(Boolean);
    const cookieParts = [];
    for (const c of cookieHeaders) {
      const firstPart = c.split(';')[0];
      if (firstPart) cookieParts.push(firstPart.trim());
      const csrfMatch = c.match(/operza_csrf=([^;]+)/);
      if (csrfMatch) csrfToken = decodeURIComponent(csrfMatch[1]);
    }
    sessionCookie = cookieParts.join('; ');
    assert.ok(sessionCookie, 'Session cookie must be captured');
  });

  let createdWorkflowId = '';

  // ══════════════════════════════════════════════════════════════════════
  // GAP 1: Workflow Builder Persistence & Fresh Context Retrieval
  // ══════════════════════════════════════════════════════════════════════
  await t.test('3. Create and persist multi-node workflow with nodes and connections', async () => {
    const multiNodeWorkflow = {
      name: 'Omnichannel Inbound Lead Nurture',
      status: 'draft',
      trigger: {
        kind: 'form_submitted',
        detail: 'Executive Inbound Strategy Form'
      },
      actions: [
        {
          id: 'step_tag_vip',
          kind: 'tag',
          label: 'Tag Contact Enterprise VIP',
          config: { tag: 'enterprise-vip' }
        },
        {
          id: 'step_ai_classify',
          kind: 'ai_classify',
          label: 'Classify Lead Intent & Budget',
          config: { model: 'embedded', prompt: 'Classify intent and budget tier' }
        },
        {
          id: 'step_webhook_crm',
          kind: 'webhook',
          label: 'Dispatch Outbound Webhook to Hubspot',
          config: { url: 'https://api.hubspot.com/v1/inbound', method: 'POST' }
        }
      ],
      enrolled: 0,
      completed: 0
    };

    const res = await fetch(`${BASE_URL}/api/crm/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify(multiNodeWorkflow)
    });

    assert.equal(res.status, 201, 'Workflow creation must return 201');
    const created = await res.json();
    assert.ok(created.id, 'Workflow must have generated backend ID');
    assert.equal(created.name, 'Omnichannel Inbound Lead Nurture');
    assert.equal(created.actions.length, 3, 'Must retain all 3 action nodes');
    createdWorkflowId = created.id;
  });

  await t.test('4. Retrieve workflow in fresh context with zero cached state', async () => {
    // Fresh request using independent context (no local cache / localStorage)
    const res = await fetch(`${BASE_URL}/api/crm/workflows/${createdWorkflowId}`, {
      headers: {
        Cookie: sessionCookie
      }
    });

    assert.equal(res.status, 200, 'Must retrieve record from backend database');
    const workflow = await res.json();
    assert.equal(workflow.id, createdWorkflowId);
    assert.equal(workflow.name, 'Omnichannel Inbound Lead Nurture');
    assert.equal(workflow.trigger.kind, 'form_submitted');
    assert.equal(workflow.actions.length, 3);
    assert.equal(workflow.actions[0].id, 'step_tag_vip');
    assert.equal(workflow.actions[1].kind, 'ai_classify');
    assert.equal(workflow.actions[2].kind, 'webhook');
  });

  await t.test('5. Unsuccessful save produces visible error and does not falsely report success', async () => {
    // Attempting to create workflow with missing required name
    const invalidWorkflow = {
      // name is missing (required by schema)
      trigger: { kind: 'form_submitted' }
    };

    const res = await fetch(`${BASE_URL}/api/crm/workflows`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify(invalidWorkflow)
    });

    // In server.mjs collections schema, workflows require 'name'
    // If name is not provided, the server rejects or does not fulfill requirement
    const data = await res.json();
    // Verify it was either rejected with 400/422 or if created, name was not empty
    if (res.status === 201) {
      assert.fail('Workflow without required name should not return 201 success');
    } else {
      assert.ok(res.status >= 400, 'Server must return error status code');
      assert.ok(data.error, 'Error message must be present in response');
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // GAP 2: Concurrent Appointment Booking & Race Condition Prevention
  // ══════════════════════════════════════════════════════════════════════
  let calendarSlug = '';

  await t.test('6. Setup test calendar for concurrent booking', async () => {
    calendarSlug = `calendar-${Date.now()}`;
    const calRes = await fetch(`${BASE_URL}/api/crm/calendars`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operza-csrf': csrfToken,
        Cookie: sessionCookie
      },
      body: JSON.stringify({
        name: 'VIP Executive Consultation',
        slug: calendarSlug,
        durationMin: 30,
        availability: ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'],
        status: 'active'
      })
    });
    assert.equal(calRes.status, 201);
  });

  await t.test('7. Two concurrent requests to exact same slot: exactly one 201 and one 409', async () => {
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const targetSlot = '14:00';

    const reqA = fetch(`${BASE_URL}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice Henderson',
        email: 'alice.henderson@test.com',
        date: tomorrowStr,
        timeSlot: targetSlot,
        notes: 'Client A booking attempt'
      })
    });

    const reqB = fetch(`${BASE_URL}/api/calendars/book/${calendarSlug}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Bob Sterling',
        email: 'bob.sterling@test.com',
        date: tomorrowStr,
        timeSlot: targetSlot,
        notes: 'Client B booking attempt'
      })
    });

    // Fire both requests concurrently
    const [resA, resB] = await Promise.all([reqA, reqB]);

    const statuses = [resA.status, resB.status].sort();
    assert.deepEqual(statuses, [201, 409], 'Exactly one request must succeed (201) and the other must be rejected with 409 Conflict');

    const conflictRes = resA.status === 409 ? resA : resB;
    const conflictBody = await conflictRes.json();
    assert.ok(conflictBody.error.includes('no longer available'), 'Conflict body must explain slot is no longer available');

    // Verify database contains EXACTLY ONE active booking for this slot
    const listRes = await fetch(`${BASE_URL}/api/crm/appointments`, {
      headers: { Cookie: sessionCookie }
    });
    const appointmentsData = await listRes.json();
    const list = Array.isArray(appointmentsData) ? appointmentsData : (appointmentsData.data || []);
    const matching = list.filter((a) => a.startsAt.startsWith(tomorrowStr) && a.startsAt.includes(`T${targetSlot}:`));
    assert.equal(matching.length, 1, 'Database must contain exactly 1 booking for this slot');
  });

  await t.test('8. High-concurrency stress test: 10 simultaneous bookings to same slot', async () => {
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const targetSlot = '15:00';

    // 10 concurrent clients
    const clients = Array.from({ length: 10 }, (_, i) => ({
      name: `Competitor ${i + 1}`,
      email: `competitor-${i + 1}@rapid-fire.test`,
      date: tomorrowStr,
      timeSlot: targetSlot,
      notes: `Concurrent attempt ${i + 1}`
    }));

    const responses = await Promise.all(
      clients.map((payload) =>
        fetch(`${BASE_URL}/api/calendars/book/${calendarSlug}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      )
    );

    const statusCounts = { 201: 0, 409: 0, other: 0 };
    for (const r of responses) {
      if (r.status === 201) statusCounts[201]++;
      else if (r.status === 409) statusCounts[409]++;
      else statusCounts.other++;
    }

    assert.equal(statusCounts[201], 1, 'Under 10 concurrent requests, EXACTLY ONE must receive 201');
    assert.equal(statusCounts[409], 9, 'Under 10 concurrent requests, EXACTLY NINE must receive 409 Conflict');
    assert.equal(statusCounts.other, 0, 'Zero unexpected status codes under concurrency');

    // Verify database authoritative record count
    const listRes = await fetch(`${BASE_URL}/api/crm/appointments`, {
      headers: { Cookie: sessionCookie }
    });
    const appointmentsData = await listRes.json();
    const list = Array.isArray(appointmentsData) ? appointmentsData : (appointmentsData.data || []);
    const matching = list.filter((a) => a.startsAt.startsWith(tomorrowStr) && a.startsAt.includes(`T${targetSlot}:`));
    assert.equal(matching.length, 1, 'Authoritative storage must contain exactly 1 active appointment for 15:00');
  });

  await t.test('9. Clean teardown', async () => {
    if (serverProcess && !serverExited) {
      serverProcess.kill('SIGTERM');
      await sleep(500);
    }
    try {
      rmSync(path.join(root, 'apps/api', TEST_STORE), { force: true });
    } catch {}
  });
});
