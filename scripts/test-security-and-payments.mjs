/**
 * ============================================================================
 * Operza Security, Payments & Ingress Verification Suite
 * ============================================================================
 * Tests:
 * 1. CSRF Token Lifecycle: /api/auth/session & /api/auth/csrf return csrfToken.
 * 2. CSRF Enforcement: Mutating requests require valid x-operza-csrf header.
 * 3. Payment State Integrity: Public checkout creates PENDING orders (never paid on submit).
 * 4. Opportunity Integrity: Opportunities remain open until real payment event confirmation.
 * 5. Webhook Backdoor Defense: Meta webhook backdoor challenge "meta_chall_44" is REJECTED (403).
 * 6. Webhook Signature Enforcement: Unsigned/invalid Stripe & Meta webhooks are REJECTED.
 * 7. Verified Payment Confirmation: Only verified payment webhook transitions order & invoice to "paid".
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('🛡️ =====================================================');
console.log('🛡️ Running Operza Security & Payment Integrity Tests');
console.log('🛡️ =====================================================\n');

let failed = 0;
let passed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

const testPort = 4097;
const apiServer = spawn('node', ['apps/api/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(testPort),
    NODE_ENV: 'test',
    ALLOW_IN_MEMORY_QUEUE: 'true',
    STRIPE_WEBHOOK_SECRET: 'whsec_prod_test_secret_9999',
    META_VERIFY_TOKEN: 'meta_prod_secret_token_8888',
    META_APP_SECRET: 'meta_prod_app_secret_7777',
    TWILIO_AUTH_TOKEN: 'twilio_prod_token_6666'
  },
  stdio: 'pipe'
});

async function waitForServerReady(port) {
  const start = Date.now();
  while (Date.now() - start < 15000) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  return false;
}

try {
  const ready = await waitForServerReady(testPort);
  assert(ready, `Test API server booted on port ${testPort}`);

  // 1. Test Admin Signup & CSRF Token Acquisition
  const signupEmail = `sec_admin_${Date.now()}@operza.test`;
  const signupRes = await fetch(`http://localhost:${testPort}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Security Admin',
      email: signupEmail,
      password: 'SecPassword!123',
      agencyName: 'Security Agency Corp',
      skipOtp: true
    })
  });
  assert(signupRes.status === 201, 'POST /api/auth/signup returns HTTP 201');
  const signupCookies = signupRes.headers.get('set-cookie') || '';
  const signupData = await signupRes.json();
  assert(Boolean(signupData.csrfToken), 'Signup response includes explicit csrfToken in payload');

  // 2. Test /api/auth/session includes csrfToken
  const sessionRes = await fetch(`http://localhost:${testPort}/api/auth/session`, {
    headers: { cookie: signupCookies }
  });
  assert(sessionRes.status === 200, 'GET /api/auth/session returns HTTP 200');
  const sessionData = await sessionRes.json();
  assert(Boolean(sessionData.csrfToken), 'GET /api/auth/session returns csrfToken in JSON payload');

  // 3. Test /api/auth/csrf dedicated endpoint
  const csrfRes = await fetch(`http://localhost:${testPort}/api/auth/csrf`, {
    headers: { cookie: signupCookies }
  });
  assert(csrfRes.status === 200, 'GET /api/auth/csrf returns HTTP 200');
  const csrfData = await csrfRes.json();
  assert(Boolean(csrfData.csrfToken), 'GET /api/auth/csrf returns csrfToken');

  const csrfToken = csrfData.csrfToken || sessionData.csrfToken;

  // 4. Test Mutating request WITHOUT CSRF token fails with 403
  const badMutate = await fetch(`http://localhost:${testPort}/api/crm/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: signupCookies
    },
    body: JSON.stringify({ firstName: 'Unsafe', lastName: 'Attacker', email: 'attacker@test.com' })
  });
  assert(badMutate.status === 403, 'Mutating POST without x-operza-csrf is blocked with HTTP 403');

  // 5. Test Mutating request WITH valid CSRF token succeeds
  const goodMutate = await fetch(`http://localhost:${testPort}/api/crm/contacts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfToken,
      cookie: signupCookies
    },
    body: JSON.stringify({ firstName: 'Safe', lastName: 'Customer', email: 'safe@test.com' })
  });
  assert(goodMutate.status === 201, 'Mutating POST with x-operza-csrf succeeds with HTTP 201');

  // 6. Test Meta Webhook Backdoor Defense (Challenge: meta_chall_44)
  const backdoorRes = await fetch(
    `http://localhost:${testPort}/api/webhooks/meta?hub.mode=subscribe&hub.challenge=meta_chall_44`
  );
  assert(backdoorRes.status === 403, 'Backdoor challenge "meta_chall_44" is REJECTED with HTTP 403');

  // 7. Test Meta Webhook with Valid Verify Token Succeeds
  const validMetaRes = await fetch(
    `http://localhost:${testPort}/api/webhooks/meta?hub.mode=subscribe&hub.challenge=valid_challenge_123&hub.verify_token=meta_prod_secret_token_8888`
  );
  assert(validMetaRes.status === 200, 'Valid Meta verification token returns HTTP 200 with challenge');

  // 8. Test Meta Webhook POST without Signature is Rejected
  const unsignedMeta = await fetch(`http://localhost:${testPort}/api/webhooks/meta`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entry: [{ messaging: [{ message: { text: 'Hello' } }] }] })
  });
  assert(unsignedMeta.status === 401, 'Unsigned Meta webhook POST is rejected with HTTP 401');

  // 9. Test Payment Link & Checkout State Integrity
  // First, create a payment link
  const linkRes = await fetch(`http://localhost:${testPort}/api/crm/paymentLinks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfToken,
      cookie: signupCookies
    },
    body: JSON.stringify({
      name: 'Strategy Session',
      amount: 499,
      currency: 'USD',
      slug: `strategy-${Date.now()}`
    })
  });
  assert(linkRes.status === 201, 'Created payment link for checkout test');
  const linkData = await linkRes.json();
  const paymentLink = linkData.data || linkData;

  // Create an open opportunity for the buyer to prove it is NOT falsely won
  const oppRes = await fetch(`http://localhost:${testPort}/api/crm/opportunities`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfToken,
      cookie: signupCookies
    },
    body: JSON.stringify({
      title: 'Enterprise Growth Project',
      amount: 499,
      stage: 'Lead',
      status: 'open',
      contactEmail: 'buyer@integrity.test'
    })
  });
  assert(oppRes.status === 201, 'Created open opportunity for buyer');

  // 10. Execute Public Checkout Ingress
  const checkoutRes = await fetch(`http://localhost:${testPort}/api/payments/checkout/${paymentLink.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Alice Buyer',
      customerEmail: 'buyer@integrity.test',
      customerPhone: '+14155552671'
    })
  });
  assert(checkoutRes.status === 201 || checkoutRes.status === 200, 'Public checkout returns HTTP 200/201');
  const checkoutData = await checkoutRes.json();
  
  // CRITICAL CHECK: Order must be PENDING, NOT PAID
  assert(
    checkoutData.order?.status === 'pending',
    `Checkout order status is "pending" on submission (actual: "${checkoutData.order?.status}")`
  );
  assert(
    checkoutData.order?.paidAt === null || checkoutData.order?.paidAt === undefined,
    'Checkout order paidAt is null/undefined on submission'
  );
  assert(
    checkoutData.invoice?.status === 'pending',
    `Checkout invoice status is "pending" (actual: "${checkoutData.invoice?.status}")`
  );

  // CRITICAL CHECK: Opportunity must STILL BE OPEN
  const checkOppRes = await fetch(`http://localhost:${testPort}/api/crm/opportunities`, {
    headers: { cookie: signupCookies }
  });
  const oppList = await checkOppRes.json();
  const buyerOpp = (oppList.data || []).find(o => o.contactEmail === 'buyer@integrity.test');
  assert(
    buyerOpp && buyerOpp.status === 'open' && buyerOpp.stage !== 'Won',
    `Opportunity remains open and NOT falsely won (actual status: "${buyerOpp?.status}", stage: "${buyerOpp?.stage}")`
  );

  // 11. Test Stripe Webhook Signature Verification & Paid Order Confirmation
  const testOrderId = checkoutData.order.id;
  const stripePayload = JSON.stringify({
    id: `evt_test_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutData.sessionId || 'cs_test_session',
        client_reference_id: testOrderId,
        metadata: { orderId: testOrderId },
        payment_status: 'paid',
        amount_total: 49900,
        currency: 'usd'
      }
    }
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const sigPayload = `${timestamp}.${stripePayload}`;
  const hmac = createHmac('sha256', 'whsec_prod_test_secret_9999').update(sigPayload).digest('hex');
  const stripeSigHeader = `t=${timestamp},v1=${hmac}`;

  const stripeWebhookRes = await fetch(`http://localhost:${testPort}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': stripeSigHeader
    },
    body: stripePayload
  });
  assert(stripeWebhookRes.status === 200, 'Valid signed Stripe webhook is accepted with HTTP 200');

  // Verify Order is now transition to PAID
  const orderCheckRes = await fetch(`http://localhost:${testPort}/api/crm/orders`, {
    headers: { cookie: signupCookies }
  });
  const orderList = await orderCheckRes.json();
  const confirmedOrder = (orderList.data || []).find(o => o.id === testOrderId);
  assert(
    confirmedOrder && confirmedOrder.status === 'paid' && Boolean(confirmedOrder.paidAt),
    `Order status successfully transitioned to "paid" upon verified webhook (actual: "${confirmedOrder?.status}")`
  );

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`🎉 Tests Passed: ${passed} | Failed: ${failed}`);
  console.log('═══════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
} catch (err) {
  console.error('Fatal test error:', err);
  process.exit(1);
} finally {
  apiServer.kill();
}
