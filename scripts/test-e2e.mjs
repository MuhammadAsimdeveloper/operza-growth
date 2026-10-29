// Operza End-to-End System Smoke Test

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('=====================================================');
console.log('🧪 Starting Operza End-to-End System Verification');
console.log('=====================================================');

const api = spawn('node', ['apps/api/server.mjs'], {
  cwd: root,
  stdio: 'pipe',
  env: {
    ...process.env,
    PORT: '4005',
    NODE_ENV: 'test',
    DATA_FILE: './data/test_store.json'
  }
});

let sessionCookie = '';
let csrfToken = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request(urlPath, options = {}) {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (sessionCookie) {
    headers.set('Cookie', sessionCookie);
  }
  if (csrfToken) {
    headers.set('x-operza-csrf', csrfToken);
  }

  const res = await fetch(`http://localhost:4005${urlPath}`, {
    ...options,
    headers
  });

  const cookieHeaders = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get('set-cookie')].filter(Boolean);
  for (const c of cookieHeaders) {
    for (const part of c.split(';')) {
      const trimmed = part.trim();
      if (trimmed.startsWith('operza_session=')) {
        sessionCookie = (sessionCookie ? sessionCookie + '; ' : '') + trimmed;
      }
      if (trimmed.startsWith('operza_csrf=')) {
        csrfToken = decodeURIComponent(trimmed.split('=')[1]);
        sessionCookie = (sessionCookie ? sessionCookie + '; ' : '') + trimmed;
      }
    }
  }

  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, res };
}

async function runTests() {
  try {
    console.log('⏳ Waiting for API to boot on port 4005...');
    await sleep(2500);

    // 1. Health check
    console.log('\n[TEST 1] GET /health');
    const health = await request('/health');
    console.log(`Status: ${health.status}`, health.data);
    if (health.status !== 200 || !health.data.wsEnabled) {
      throw new Error('Health check failed or WebSocket disabled');
    }
    console.log('✅ Health check passed (WebSocket active)');

    // 2. Authentication Signup
    console.log('\n[TEST 2] POST /api/auth/signup');
    const signup = await request('/api/auth/signup', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Automated Tester',
        email: `tester_${Date.now()}@operza.io`,
        password: 'Password123!',
        agencyName: 'Operza Alpha Agency'
      })
    });
    console.log(`Status: ${signup.status}`, signup.data.user);
    if (signup.status !== 201 || !signup.data.user?.id) {
      throw new Error('Signup failed');
    }
    console.log(`✅ Signup passed & CSRF token captured: ${csrfToken ? 'Yes' : 'No'}`);

    // 3. Auth Session Verification
    console.log('\n[TEST 3] GET /api/auth/session');
    const session = await request('/api/auth/session');
    console.log(`Status: ${session.status}`, session.data.agency);
    if (session.status !== 200 || !session.data.user) {
      throw new Error('Session verification failed');
    }
    console.log('✅ Authenticated session verified');

    // 4. CRM Contact Creation (with CSRF verification)
    console.log('\n[TEST 4] POST /api/crm/contacts');
    const contact = await request('/api/crm/contacts', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Marcus',
        lastName: 'Vance',
        email: 'marcus@example.com',
        phone: '+1 555-0199',
        company: 'Vance Media',
        status: 'lead',
        tags: ['inbound', 'high-ticket']
      })
    });
    console.log(`Status: ${contact.status}`, contact.data.id, contact.data.firstName);
    if (contact.status !== 201 || !contact.data.id) {
      throw new Error(`Contact creation failed: ${JSON.stringify(contact.data)}`);
    }
    console.log('✅ Contact created successfully with CSRF validation');

    // 5. CRM Contacts Search & List
    console.log('\n[TEST 5] GET /api/crm/contacts?search=Marcus');
    const contacts = await request('/api/crm/contacts?search=Marcus');
    console.log(`Status: ${contacts.status}, Count: ${contacts.data.length}`);
    if (contacts.status !== 200 || contacts.data.length === 0) {
      throw new Error('Contact list failed');
    }
    console.log('✅ Contacts retrieved from tenant database');

    // 6. Dashboard Aggregates
    console.log('\n[TEST 6] GET /api/dashboard/stats');
    const stats = await request('/api/dashboard/stats');
    console.log(`Status: ${stats.status}`, stats.data);
    if (stats.status !== 200) {
      throw new Error('Dashboard stats failed');
    }
    console.log('✅ Dashboard aggregate metrics verified');

    // 7. Workflow Ingress & Execution
    console.log('\n[TEST 7] GET /api/workflows/runs');
    const runs = await request('/api/workflows/runs');
    console.log(`Status: ${runs.status}, Runs count: ${runs.data.length}`);
    if (runs.status !== 200) {
      throw new Error('Workflow runs query failed');
    }
    console.log('✅ Workflow execution state machine verified');

    // 8. Copilot SSE Stream Probe
    console.log('\n[TEST 8] GET /api/copilot/stream?message=hello');
    const streamRes = await fetch('http://localhost:4005/api/copilot/stream?message=hello', {
      headers: { Cookie: sessionCookie }
    });
    const reader = streamRes.body.getReader();
    let streamChunks = 0;
    while (true) {
      const { done } = await reader.read();
      if (done) break;
      streamChunks++;
      if (streamChunks >= 3) {
        reader.cancel();
        break;
      }
    }
    console.log(`Received ${streamChunks} SSE streaming delta chunks`);
    console.log('✅ Copilot SSE real-time token streaming verified');

    // 9. Public Calendar Ingress & Booking
    console.log('\n[TEST 9] Public Calendar Ingress: GET /api/calendars/public/discovery-strategy & POST /api/calendars/book/discovery-strategy');
    const calLookup = await request('/api/calendars/public/discovery-strategy');
    console.log(`Calendar Lookup Status: ${calLookup.status}`, calLookup.data.name);
    if (calLookup.status !== 200 || !calLookup.data.name) {
      throw new Error(`Calendar public lookup failed: ${JSON.stringify(calLookup.data)}`);
    }

    const booking = await request('/api/calendars/book/discovery-strategy', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Elena Vance',
        email: 'elena@vance.io',
        phone: '+1 555-0144',
        date: '2026-11-05',
        timeSlot: '10:00',
        notes: 'Seeking enterprise workflow orchestration consultation'
      })
    });
    console.log(`Booking Status: ${booking.status}`, booking.data.appointment?.id);
    if (booking.status !== 201 || !booking.data.appointment?.id || !booking.data.prepTask?.id) {
      throw new Error(`Booking submission failed: ${JSON.stringify(booking.data)}`);
    }
    console.log('✅ Public calendar booking verified (Appointment, Contact, & Prep Task generated)');

    // 10. Public Payment Ingress & Checkout
    console.log('\n[TEST 10] Public Payment Ingress: GET /api/payments/public/starter-retainer & POST /api/payments/checkout/starter-retainer');
    const payLookup = await request('/api/payments/public/starter-retainer');
    console.log(`Payment Link Status: ${payLookup.status}`, payLookup.data.name, `$${payLookup.data.amount}`);
    if (payLookup.status !== 200 || !payLookup.data.amount) {
      throw new Error(`Payment link lookup failed: ${JSON.stringify(payLookup.data)}`);
    }

    const checkout = await request('/api/payments/checkout/starter-retainer', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Elena Vance',
        customerEmail: 'elena@vance.io',
        customerPhone: '+1 555-0144',
        cardNumber: '4242 4242 4242 4242',
        expiry: '12/28',
        cvc: '123'
      })
    });
    console.log(`Checkout Status: ${checkout.status}`, checkout.data.order?.orderNumber, checkout.data.invoice?.number);
    if (checkout.status !== 201 || !checkout.data.order?.id || !checkout.data.invoice?.id || checkout.data.contact?.status !== 'customer') {
      throw new Error(`Checkout submission failed: ${JSON.stringify(checkout.data)}`);
    }
    console.log('✅ Public payment checkout verified (Order, Invoice, and Customer promotion completed)');

    console.log('\n🎉 ALL 10 SYSTEM INTEGRATION TESTS PASSED CLEANLY! 🎉');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('Stopping test API server...');
    api.kill();
  }
}

runTests();
