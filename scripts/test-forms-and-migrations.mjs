/**
 * ============================================================================
 * Operza Tenant Forms, Form Ingress & Multi-Tenant Migration Integrity Suite
 * ============================================================================
 * Tests:
 * 1. Form Creation & Tenant Storage (Agency A creates published form).
 * 2. Public Form Resolution: GET /api/forms/public/:slug returns sanitized form.
 * 3. Secret Leak Prevention: Public form lookup strips agencyId & locationId.
 * 4. Unpublished Protection: Draft / unpublished forms return 404 on public lookup.
 * 5. Public Form Submission: POST /api/forms/submit/:slug captures contact,
 *    creates form submission, creates pipeline opportunity & increments counter.
 * 6. Cross-Agency Isolation: Agency B cannot read, list or publish Agency A's forms.
 * 7. Cross-Agency Submissions Isolation: Agency B cannot view Agency A's submissions.
 * 8. Relational Write Integrity: syncRelationalWrite handles forms, formSubmissions,
 *    orders, and invoices safely without unhandled exceptions.
 * ============================================================================
 */

import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

console.log('📋 =====================================================');
console.log('📋 Running Operza Tenant Forms & Migration Integrity Tests');
console.log('📋 =====================================================\n');

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

const testPort = 4096;
const apiServer = spawn('node', ['apps/api/server.mjs'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(testPort),
    NODE_ENV: 'test',
    ALLOW_IN_MEMORY_QUEUE: 'true',
    STRIPE_WEBHOOK_SECRET: 'whsec_forms_test_secret_9999'
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
  assert(ready, `Test API server successfully booted on port ${testPort}`);

  // 1. Sign up Agency A
  const emailA = `forms_owner_a_${Date.now()}@operza.test`;
  const signupResA = await fetch(`http://localhost:${testPort}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Agency A Admin',
      email: emailA,
      password: 'StrongPassword!123',
      agencyName: 'Agency Alpha Corp',
      skipOtp: true
    })
  });
  assert(signupResA.status === 201, 'Agency A signed up successfully (HTTP 201)');
  const cookiesA = signupResA.headers.get('set-cookie') || '';
  const dataA = await signupResA.json();
  const csrfA = dataA.csrfToken;
  assert(Boolean(csrfA), 'Agency A received valid CSRF token');

  // 2. Sign up Agency B
  const emailB = `forms_owner_b_${Date.now()}@operza.test`;
  const signupResB = await fetch(`http://localhost:${testPort}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Agency B Admin',
      email: emailB,
      password: 'StrongPassword!123',
      agencyName: 'Agency Beta Corp',
      skipOtp: true
    })
  });
  assert(signupResB.status === 201, 'Agency B signed up successfully (HTTP 201)');
  const cookiesB = signupResB.headers.get('set-cookie') || '';
  const dataB = await signupResB.json();
  const csrfB = dataB.csrfToken;
  assert(Boolean(csrfB), 'Agency B received valid CSRF token');

  // 3. Agency A creates a published form
  const formSlug = `intake-${Date.now().toString().slice(-6)}`;
  const createFormRes = await fetch(`http://localhost:${testPort}/api/crm/forms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfA,
      cookie: cookiesA
    },
    body: JSON.stringify({
      name: 'Client Growth Consultation',
      publicSlug: formSlug,
      fields: ['firstName', 'lastName', 'email', 'phone', 'company', 'budget'],
      status: 'published',
      published: true,
      description: 'Request a strategic growth audit for your enterprise.'
    })
  });
  assert(createFormRes.status === 201, 'Agency A created published form (HTTP 201)');
  const createdForm = await createFormRes.json();
  assert(createdForm.name === 'Client Growth Consultation', 'Form name matches request');
  assert(createdForm.publicSlug === formSlug, 'Form publicSlug matches request');
  assert(Boolean(createdForm.id), 'Form has unique identifier');

  // 4. Public Form Lookup (anonymous request without cookies)
  const publicRes = await fetch(`http://localhost:${testPort}/api/forms/public/${formSlug}`);
  assert(publicRes.status === 200, 'Public form lookup succeeds (HTTP 200)');
  const publicData = await publicRes.json();
  assert(publicData.name === 'Client Growth Consultation', 'Public form returns correct name');
  assert(Array.isArray(publicData.fields) && publicData.fields.includes('budget'), 'Public form returns fields array');
  assert(publicData.agencyId === undefined, 'Public form does NOT expose agencyId (security check)');
  assert(publicData.locationId === undefined, 'Public form does NOT expose locationId (security check)');

  // 5. Non-existent form returns 404
  const nonExistentRes = await fetch(`http://localhost:${testPort}/api/forms/public/missing-slug-9999`);
  assert(nonExistentRes.status === 404, 'Non-existent public form returns HTTP 404');

  // 6. Agency A toggles form to draft / unpublished
  const unpublishRes = await fetch(`http://localhost:${testPort}/api/forms/${createdForm.id}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfA,
      cookie: cookiesA
    },
    body: JSON.stringify({ published: false })
  });
  assert(unpublishRes.status === 200, 'Agency A unpublishes form (HTTP 200)');

  // 7. Verify draft form cannot be viewed publicly
  const draftPublicRes = await fetch(`http://localhost:${testPort}/api/forms/public/${formSlug}`);
  assert(draftPublicRes.status === 404, 'Draft / unpublished form is blocked from public resolution (HTTP 404)');

  // 8. Re-publish form for submission testing
  const republishRes = await fetch(`http://localhost:${testPort}/api/forms/${createdForm.id}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfA,
      cookie: cookiesA
    },
    body: JSON.stringify({ published: true })
  });
  assert(republishRes.status === 200, 'Agency A re-publishes form (HTTP 200)');

  // 9. Public Form Submission
  const leadEmail = `lead_${Date.now()}@customer.test`;
  const submitRes = await fetch(`http://localhost:${testPort}/api/forms/submit/${formSlug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      answers: {
        firstName: 'Sarah',
        lastName: 'Connor',
        email: leadEmail,
        phone: '+1-555-0199',
        company: 'Cyberdyne Systems',
        budget: '$50,000'
      },
      source: 'marketing_landing_page'
    })
  });
  assert(submitRes.status === 200, 'Public form submission succeeds (HTTP 200)');
  const submitData = await submitRes.json();
  assert(submitData.success === true, 'Submission response indicates success: true');
  assert(Boolean(submitData.contactId), 'Submission response returns created contactId');
  assert(Boolean(submitData.submissionId), 'Submission response returns created submissionId');

  // 10. Verify Agency A can retrieve the contact
  const contactRes = await fetch(`http://localhost:${testPort}/api/crm/contacts/${submitData.contactId}`, {
    headers: { cookie: cookiesA }
  });
  assert(contactRes.status === 200, 'Agency A can retrieve newly created contact (HTTP 200)');
  const contactData = await contactRes.json();
  assert(contactData.email === leadEmail, 'Contact email matches submission answers');
  assert(contactData.firstName === 'Sarah' && contactData.lastName === 'Connor', 'Contact name matches answers');
  assert(contactData.tags?.includes('web-lead'), 'Contact has "web-lead" tag');

  // 11. Verify Agency A can retrieve the form submission
  const subRes = await fetch(`http://localhost:${testPort}/api/forms/submissions?formId=${createdForm.id}`, {
    headers: { cookie: cookiesA }
  });
  assert(subRes.status === 200, 'Agency A retrieves submissions for form (HTTP 200)');
  const subData = await subRes.json();
  assert(subData.submissions.length >= 1, 'Agency A has at least 1 recorded submission');
  const leadSub = subData.submissions.find(s => s.id === submitData.submissionId);
  assert(Boolean(leadSub), 'Submission found with matching submissionId');
  assert(leadSub?.answers?.budget === '$50,000', 'Submission payload contains form answers');

  // 12. Verify Agency A has an opportunity generated from the form
  const oppsRes = await fetch(`http://localhost:${testPort}/api/crm/opportunities`, {
    headers: { cookie: cookiesA }
  });
  assert(oppsRes.status === 200, 'Agency A retrieves CRM opportunities (HTTP 200)');
  const oppsData = await oppsRes.json();
  const createdOpp = (oppsData.data || oppsData).find(o => o.contactId === submitData.contactId);
  assert(Boolean(createdOpp), 'Inbound opportunity generated for contact');
  assert(createdOpp?.pipeline === 'Lead Pipeline', 'Opportunity assigned to default pipeline');

  // 13. Verify Form Submissions counter incremented
  const formCheckRes = await fetch(`http://localhost:${testPort}/api/crm/forms/${createdForm.id}`, {
    headers: { cookie: cookiesA }
  });
  assert(formCheckRes.status === 200, 'Agency A can inspect form details');
  const formCheckData = await formCheckRes.json();
  assert(formCheckData.submissions === 1, 'Form submission counter incremented to 1');

  // =========================================================================
  // MULTI-TENANT ISOLATION TESTS (Agency B vs Agency A)
  // =========================================================================

  // 14. Agency B CANNOT view Agency A's form submissions
  const crossSubRes = await fetch(`http://localhost:${testPort}/api/forms/submissions?formId=${createdForm.id}`, {
    headers: { cookie: cookiesB }
  });
  assert(crossSubRes.status === 200, 'Agency B requests submissions endpoint');
  const crossSubData = await crossSubRes.json();
  assert(crossSubData.submissions.length === 0, 'Cross-tenant protection: Agency B sees 0 submissions from Agency A');

  // 15. Agency B CANNOT publish or modify Agency A's form
  const crossPublishRes = await fetch(`http://localhost:${testPort}/api/forms/${createdForm.id}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfB,
      cookie: cookiesB
    },
    body: JSON.stringify({ published: false })
  });
  assert(crossPublishRes.status === 404, 'Cross-tenant protection: Agency B cannot modify Agency A form (HTTP 404)');

  // 16. Agency B CANNOT read Agency A's form via CRM API
  const crossFormRes = await fetch(`http://localhost:${testPort}/api/crm/forms/${createdForm.id}`, {
    headers: { cookie: cookiesB }
  });
  assert(crossFormRes.status === 404, 'Cross-tenant protection: Agency B cannot view Agency A form via CRM API (HTTP 404)');

  // 17. Agency B CANNOT read Agency A's captured contact
  const crossContactRes = await fetch(`http://localhost:${testPort}/api/crm/contacts/${submitData.contactId}`, {
    headers: { cookie: cookiesB }
  });
  assert(crossContactRes.status === 404, 'Cross-tenant protection: Agency B cannot read Agency A contact (HTTP 404)');

  // =========================================================================
  // CHECKOUT ORDERS & INVOICES INTEGRITY
  // =========================================================================

  // 18. Agency A creates a payment link
  const linkRes = await fetch(`http://localhost:${testPort}/api/crm/paymentLinks`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-operza-csrf': csrfA,
      cookie: cookiesA
    },
    body: JSON.stringify({
      name: 'Enterprise Consulting Deposit',
      slug: `consulting-dep-${Date.now().toString().slice(-5)}`,
      amount: 1500,
      currency: 'USD',
      active: true
    })
  });
  assert(linkRes.status === 201, 'Agency A creates payment link (HTTP 201)');
  const linkData = await linkRes.json();

  // 19. Public checkout creates pending order & invoice
  const checkoutRes = await fetch(`http://localhost:${testPort}/api/payments/checkout/${linkData.slug}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'Marcus Brody',
      customerEmail: 'brody@museum.test',
      customerPhone: '+1-555-8888'
    })
  });
  assert(checkoutRes.status === 201, 'Public checkout succeeds (HTTP 201)');
  const checkoutData = await checkoutRes.json();
  assert(checkoutData.status === 'pending', 'Checkout creates PENDING order');
  assert(checkoutData.order.paidAt === null, 'Order paidAt is null');
  assert(checkoutData.invoice.status === 'pending', 'Invoice is in pending status');

  // 20. Verified Stripe Webhook confirms payment
  const stripeEvent = {
    id: `evt_test_${Date.now()}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: checkoutData.sessionId,
        payment_status: 'paid',
        client_reference_id: checkoutData.order.id,
        metadata: { orderId: checkoutData.order.id }
      }
    }
  };
  const eventPayload = JSON.stringify(stripeEvent);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_forms_test_secret_9999')
    .update(`${timestamp}.${eventPayload}`)
    .digest('hex');

  const webhookRes = await fetch(`http://localhost:${testPort}/api/webhooks/stripe`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${timestamp},v1=${signature}`
    },
    body: eventPayload
  });
  assert(webhookRes.status === 200, 'Verified Stripe webhook accepted (HTTP 200)');

  // 21. Verify order transitioned to paid
  const orderCheckRes = await fetch(`http://localhost:${testPort}/api/crm/orders/${checkoutData.order.id}`, {
    headers: { cookie: cookiesA }
  });
  assert(orderCheckRes.status === 200, 'Agency A can inspect order (HTTP 200)');
  const orderCheckData = await orderCheckRes.json();
  assert(orderCheckData.status === 'paid', 'Order transitioned to "paid" upon verified webhook receipt');
  assert(Boolean(orderCheckData.paidAt), 'Order has recorded paidAt timestamp');

} catch (error) {
  console.error('Fatal error running form tests:', error);
  failed++;
} finally {
  apiServer.kill('SIGTERM');
  console.log('\n=====================================================');
  console.log(`📋 Test Results: ${passed} Passed, ${failed} Failed`);
  console.log('=====================================================\n');
  process.exit(failed > 0 ? 1 : 0);
}
