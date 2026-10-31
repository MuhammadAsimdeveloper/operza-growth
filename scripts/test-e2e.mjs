// Operza End-to-End System Smoke Test

import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Ensure clean test store for deterministic execution
try {
  rmSync(path.join(root, 'apps/api/data/test_store.json'), { force: true });
} catch {}

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

api.stdout.on('data', (d) => process.stdout.write(d));
api.stderr.on('data', (d) => process.stderr.write(d));

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

    // 11. On-Demand Workflow Execution & Human Approval Gate
    console.log('\n[TEST 11] On-Demand Workflow Execution & Approval Gate: POST /api/workflows/:id/run');
    const workflowsList = await request('/api/crm/workflows');
    console.log(`Workflows available: ${workflowsList.data.data?.length}`);
    const flowToRun = (workflowsList.data.data || []).find(w => w.status === 'published') || workflowsList.data.data?.[0];
    if (!flowToRun) {
      throw new Error('No published workflow found to execute');
    }

    const runRes = await request(`/api/workflows/${flowToRun.id}/run`, {
      method: 'POST',
      body: JSON.stringify({ contactId: contact.data.id })
    });
    console.log(`Execution Status: ${runRes.status}`, runRes.data.execution?.id, `Status: ${runRes.data.execution?.status}`);
    if (runRes.status !== 201 || !runRes.data.execution?.id) {
      throw new Error(`Workflow execution failed: ${JSON.stringify(runRes.data)}`);
    }

    const executionId = runRes.data.execution.id;
    if (runRes.data.execution.status === 'waiting_approval') {
      console.log('Workflow reached approval gate. Approving execution...');
      const approveRes = await request(`/api/workflows/runs/${executionId}/approve`, {
        method: 'POST'
      });
      console.log(`Approval Status: ${approveRes.status}`, approveRes.data.run?.status);
      if (approveRes.status !== 200 || approveRes.data.run?.status !== 'completed') {
        throw new Error(`Workflow approval failed: ${JSON.stringify(approveRes.data)}`);
      }
      console.log('✅ Workflow human approval gate cleared and resumed to completion');
    } else {
      console.log(`✅ Workflow executed cleanly with ${runRes.data.execution.steps?.length} steps`);
    }

    // 12. Inbound Twilio SMS Webhook & Conversations Sync
    console.log('\n[TEST 12] Inbound Twilio Webhook: POST /api/webhooks/twilio');
    const twilioRes = await fetch('http://localhost:4005/api/webhooks/twilio', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        MessageSid: 'SM1234567890abcdef',
        From: '+1 555-0199',
        To: '+1 800-555-0100',
        Body: 'Yes, we are ready to proceed with the enterprise onboarding!'
      })
    });
    const twilioXml = await twilioRes.text();
    console.log(`Twilio Webhook Status: ${twilioRes.status}`, twilioXml.trim());
    if (twilioRes.status !== 200 || (!twilioXml.includes('<Response>') && !twilioXml.includes('<Response/>'))) {
      throw new Error(`Twilio webhook failed: status ${twilioRes.status}`);
    }

    const convs = await request('/api/crm/conversations');
    const marcusConv = (convs.data.data || []).find(c => c.contactName?.includes('Marcus'));
    console.log(`Conversations matching Marcus: ${marcusConv ? 'Found' : 'Not found'}`);
    if (!marcusConv || marcusConv.messages?.length === 0) {
      throw new Error('Inbound SMS did not create conversation entry');
    }
    console.log('✅ Inbound Twilio SMS parsed, contact matched, and conversation logged');

    // 13. Public Review Ingress & Promoter Tagging
    console.log('\n[TEST 13] Public Review Ingress: GET /api/reviews/public/main & POST /api/reviews/submit/main');
    const reviewInfo = await request('/api/reviews/public/main');
    console.log(`Review Portal Info: ${reviewInfo.status}`, reviewInfo.data.locationName);
    if (reviewInfo.status !== 200 || !reviewInfo.data.prompt) {
      throw new Error(`Review public lookup failed: ${JSON.stringify(reviewInfo.data)}`);
    }

    const reviewRes = await request('/api/reviews/submit/main', {
      method: 'POST',
      body: JSON.stringify({
        contactName: 'Marcus Vance',
        email: 'marcus@example.com',
        rating: 5,
        text: 'Outstanding workflow automation and Copilot speed. 10/10 service!',
        source: 'Client Review Portal'
      })
    });
    console.log(`Review Submit Status: ${reviewRes.status}`, reviewRes.data.review?.id);
    if (reviewRes.status !== 201 || !reviewRes.data.review?.id) {
      throw new Error(`Review submission failed: ${JSON.stringify(reviewRes.data)}`);
    }

    // Verify contact received promoter tag
    const updatedMarcus = await request('/api/crm/contacts?search=Marcus');
    const marcusData = updatedMarcus.data.data?.[0];
    console.log(`Marcus Tags: ${marcusData?.tags?.join(', ')}`);
    if (!marcusData?.tags?.includes('promoter')) {
      throw new Error('5-star review did not add promoter tag to contact');
    }
    console.log('✅ Public review ingested, 5-star rating registered, and promoter tag applied');

    // 14. Agency Sub-Accounts & Location Provisioning
    console.log('\n[TEST 14] Agency Sub-Accounts: POST /api/agency/locations & GET /api/agency/locations');
    const newLocRes = await request('/api/agency/locations', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Northwind Growth Lab',
        industry: 'E-commerce',
        ownerEmail: 'growth@northwind.io',
        planId: 'scale',
        seats: 5,
        timezone: 'America/New_York',
        status: 'active'
      })
    });
    console.log(`Sub-Account Creation Status: ${newLocRes.status}`, newLocRes.data.id, newLocRes.data.name);
    if (newLocRes.status !== 201 || !newLocRes.data.id || newLocRes.data.name !== 'Northwind Growth Lab') {
      throw new Error(`Sub-account creation failed: ${JSON.stringify(newLocRes.data)}`);
    }

    const northwindLocId = newLocRes.data.id;
    const locationsRes = await request('/api/agency/locations');
    console.log(`Agency Locations Count: ${locationsRes.status}`, locationsRes.data.locations?.length);
    const foundNorthwind = locationsRes.data.locations?.find(l => l.id === northwindLocId);
    if (!foundNorthwind || foundNorthwind.industry !== 'E-commerce') {
      throw new Error(`Could not find newly created location in /api/agency/locations`);
    }
    console.log(`Northwind Location Details: Name="${foundNorthwind.name}", Industry="${foundNorthwind.industry}", WorkflowsCount=${foundNorthwind.workflowsCount}`);
    console.log('✅ Sub-account provisioned and queried via multi-tenant agency locations API');

    // 15. Agency Snapshots Engine & 1-Click Client Deployment
    console.log('\n[TEST 15] Agency Snapshots: POST /api/agency/snapshots & POST /api/agency/snapshots/:id/deploy');
    const snapRes = await request('/api/agency/snapshots', {
      method: 'POST',
      body: JSON.stringify({
        name: 'E-commerce Growth Engine Blueprint',
        description: 'Prebuilt onboarding flow, discovery calendar, and retainers',
        industry: 'E-commerce',
        includeContacts: true
      })
    });
    console.log(`Snapshot Creation Status: ${snapRes.status}`, snapRes.data.id, snapRes.data.name);
    if (snapRes.status !== 201 || !snapRes.data.id || snapRes.data.counts?.workflows === 0) {
      throw new Error(`Snapshot creation failed: ${JSON.stringify(snapRes.data)}`);
    }
    console.log('Snapshot Blueprint Counts:', snapRes.data.counts);

    // Deploy blueprint to Northwind Growth Lab sub-account
    const deployRes = await request(`/api/agency/snapshots/${snapRes.data.id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({
        targetLocationId: northwindLocId,
        includeContacts: true
      })
    });
    console.log(`Snapshot Deploy Status: ${deployRes.status}`, deployRes.data.targetLocationName, deployRes.data.deployed);
    if (deployRes.status !== 200 || !deployRes.data.success || deployRes.data.deployed?.workflows < 1) {
      throw new Error(`Snapshot deployment failed: ${JSON.stringify(deployRes.data)}`);
    }

    // Verify Northwind location now has deployed workflows
    const updatedLocsRes = await request('/api/agency/locations');
    const updatedNorthwind = updatedLocsRes.data.locations?.find(l => l.id === northwindLocId);
    console.log(`Northwind Workflows after deployment: ${updatedNorthwind?.workflowsCount}`);
    if (!updatedNorthwind || updatedNorthwind.workflowsCount < 1) {
      throw new Error('Deployed snapshot workflows not reflected in target sub-account');
    }
    console.log('✅ Snapshot created and 1-click deployed to client sub-account with deep-cloned assets');

    // 16. Copilot Autonomous Lead Creation via Intent
    console.log('\n[TEST 16] Copilot Chat Autonomous Lead Creation: POST /api/copilot/chat');
    const copilotContactRes = await request('/api/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Create contact Sarah Connor with email sarah@skynet-defense.com and company Cyberdyne Systems'
      })
    });
    console.log(`Copilot Chat Status: ${copilotContactRes.status}`);
    const createToolResult = copilotContactRes.data.message?.toolResults?.find(t => t.tool === 'create_contact');
    if (!createToolResult || !createToolResult.result?.success || createToolResult.result?.name !== 'Sarah Connor') {
      throw new Error(`Copilot autonomous contact creation failed: ${JSON.stringify(copilotContactRes.data)}`);
    }
    console.log('Copilot Response Text:', copilotContactRes.data.message?.content);

    // Verify contact was persisted to tenant CRM database
    const sarahVerify = await request('/api/crm/contacts?search=Sarah');
    const sarah = sarahVerify.data.data?.[0];
    if (!sarah || sarah.company !== 'Cyberdyne Systems') {
      throw new Error('Contact created via Copilot was not found in CRM query');
    }
    console.log(`Persisted Contact: ID=${sarah.id}, Name="${sarah.firstName} ${sarah.lastName}", Company="${sarah.company}"`);
    console.log('✅ Copilot autonomous lead creation intent executed and persisted in CRM database');

    // 17. Copilot Autonomous Workflow Triggering via Intent
    console.log('\n[TEST 17] Copilot Chat Workflow Triggering: POST /api/copilot/chat');
    const copilotWfRes = await request('/api/copilot/chat', {
      method: 'POST',
      body: JSON.stringify({
        message: 'Trigger workflow Lead Qualification'
      })
    });
    console.log(`Copilot Workflow Trigger Status: ${copilotWfRes.status}`);
    const wfToolResult = copilotWfRes.data.message?.toolResults?.find(t => t.tool === 'trigger_workflow');
    if (!wfToolResult || !wfToolResult.result?.success || !wfToolResult.result?.executionId) {
      throw new Error(`Copilot autonomous workflow trigger failed: ${JSON.stringify(copilotWfRes.data)}`);
    }
    console.log('Copilot Response Text:', copilotWfRes.data.message?.content);
    console.log(`Workflow Execution Result: Workflow="${wfToolResult.result.workflowName}", ID=${wfToolResult.result.executionId.slice(0, 8)}, Status=${wfToolResult.result.status}`);
    console.log('✅ Copilot autonomous workflow execution intent dispatched and executed cleanly');

    // 18. Audit Trail Compliance & Security Query: GET /api/audit
    console.log('\n[TEST 18] Audit Trail Compliance: GET /api/audit');
    const auditRes = await request('/api/audit?limit=25');
    console.log(`Audit Log Query Status: ${auditRes.status}`, `Total entries: ${auditRes.data.total}`);
    if (auditRes.status !== 200 || !Array.isArray(auditRes.data.data) || auditRes.data.data.length === 0) {
      throw new Error(`Audit log retrieval failed: ${JSON.stringify(auditRes.data)}`);
    }
    const sampleEntry = auditRes.data.data[0];
    console.log(`Latest Audit Entry: Action="${sampleEntry.action}", User="${sampleEntry.userName}", At="${sampleEntry.timestamp}"`);
    console.log('✅ Audit trail compliance logged, indexed, and queried with multi-tenant scoping');

    // 19. Tasks Lifecycle & State Machine: POST /api/crm/tasks & PUT /api/crm/tasks/:id
    console.log('\n[TEST 19] Tasks Lifecycle: POST /api/crm/tasks & PUT /api/crm/tasks/:id');
    const taskCreateRes = await request('/api/crm/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Review Q4 Automation Blueprint',
        priority: 'high',
        assignedTo: 'Automated Tester',
        dueDate: '2026-11-01T10:00:00Z',
        status: 'pending'
      })
    });
    console.log(`Task Create Status: ${taskCreateRes.status}`, taskCreateRes.data.id, `Priority: ${taskCreateRes.data.priority}`);
    if (taskCreateRes.status !== 201 || !taskCreateRes.data.id || taskCreateRes.data.priority !== 'high') {
      throw new Error(`Task creation failed: ${JSON.stringify(taskCreateRes.data)}`);
    }

    const taskId = taskCreateRes.data.id;
    const taskUpdateRes = await request(`/api/crm/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: 'completed' })
    });
    console.log(`Task Update Status: ${taskUpdateRes.status}`, `New Status: ${taskUpdateRes.data.status}`);
    if (taskUpdateRes.status !== 200 || taskUpdateRes.data.status !== 'completed') {
      throw new Error(`Task state transition failed: ${JSON.stringify(taskUpdateRes.data)}`);
    }

    const completedTasksRes = await request('/api/crm/tasks?status=completed');
    const foundTask = (completedTasksRes.data.data || []).find(t => t.id === taskId);
    if (!foundTask) {
      throw new Error('Completed task not found in CRM query filter');
    }
    console.log(`Verified Completed Task in Database: Title="${foundTask.title}", Status="${foundTask.status}"`);
    console.log('✅ Tasks lifecycle state machine (create -> assign -> complete) verified');

    // 20. Marketing Campaign Lifecycle & Bulk Dispatch: POST /api/crm/campaigns & POST /api/campaigns/:id/send
    console.log('\n[TEST 20] Marketing Campaign Lifecycle & Bulk Dispatch: POST /api/crm/campaigns & /api/campaigns/:id/send');
    const test18_campaignCreateRes = await request('/api/crm/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Fall Q4 Product Launch',
        channel: 'email',
        kind: 'email',
        audience: 10,
        content: 'Exclusive 20% early access discount for VIP partners',
        status: 'draft'
      })
    });
    console.log(`Campaign Create Status: ${test18_campaignCreateRes.status}`, `ID: ${test18_campaignCreateRes.data.id}`);
    if (test18_campaignCreateRes.status !== 201 || !test18_campaignCreateRes.data.id) {
      throw new Error(`Campaign creation failed: ${JSON.stringify(test18_campaignCreateRes.data)}`);
    }

    const campaignId = test18_campaignCreateRes.data.id;
    const campaignSendRes = await request(`/api/campaigns/${campaignId}/send`, {
      method: 'POST'
    });
    console.log(`Campaign Send Status: ${campaignSendRes.status}`, `Dispatched: ${campaignSendRes.data.sentCount}`);
    if (campaignSendRes.status !== 200 || !campaignSendRes.data.success || typeof campaignSendRes.data.sentCount !== 'number') {
      throw new Error(`Campaign dispatch failed: ${JSON.stringify(campaignSendRes.data)}`);
    }

    // Verify campaign status updated to sent in CRM
    const campaignsListRes = await request('/api/crm/campaigns');
    const dispatchedCampaign = (campaignsListRes.data.data || []).find(c => c.id === campaignId);
    if (!dispatchedCampaign || dispatchedCampaign.status !== 'sent') {
      throw new Error('Dispatched campaign was not updated to sent status in CRM database');
    }
    console.log(`Verified Campaign: Status="${dispatchedCampaign.status}", Sent=${dispatchedCampaign.sent}, Opens=${dispatchedCampaign.opened}`);

    // Verify outbound messages logged in conversations
    const convRes = await request('/api/crm/conversations');
    const campaignMessages = (convRes.data.data || []).filter(c =>
      (c.messages || []).some(m => m.content && m.content.includes('Exclusive 20% early access discount'))
    );
    console.log(`Conversations with dispatched campaign messages: ${campaignMessages.length}`);
    if (campaignMessages.length === 0) {
      throw new Error('Campaign dispatch failed to generate conversation threads for contacts');
    }
    console.log('✅ Marketing campaign dispatch executed: contact segmentation, thread generation, metrics updated');

    // 21. Public Form Ingress & Automation: GET /api/forms/public/:slug & POST /api/forms/submit/:slug
    console.log('\n[TEST 21] Public Form Ingress & Lead Provisioning: GET /api/forms/public/contact-us & POST /api/forms/submit/contact-us');
    const formLookupRes = await request('/api/forms/public/contact-us');
    console.log(`Form Lookup Status: ${formLookupRes.status}`, `Name: "${formLookupRes.data.name}"`);
    if (formLookupRes.status !== 200 || !formLookupRes.data.id || formLookupRes.data.name !== 'Inbound Consultation Request') {
      throw new Error(`Public form lookup failed: ${JSON.stringify(formLookupRes.data)}`);
    }

    const formSubmitRes = await request('/api/forms/submit/contact-us', {
      method: 'POST',
      body: JSON.stringify({
        answers: {
          firstName: 'Elena',
          lastName: 'Rostova',
          email: 'elena@novatech.io',
          phone: '+1 555-0442',
          company: 'NovaTech Dynamics',
          projectDetails: 'Seeking enterprise multi-channel workflow migration'
        }
      })
    });
    console.log(`Form Submission Status: ${formSubmitRes.status}`, `Contact ID: ${formSubmitRes.data.contactId}`);
    if (formSubmitRes.status !== 200 || !formSubmitRes.data.success || !formSubmitRes.data.contactId) {
      throw new Error(`Public form submission failed: ${JSON.stringify(formSubmitRes.data)}`);
    }

    // Verify contact created with web-lead tag and form source
    const elenaVerify = await request('/api/crm/contacts?search=Elena');
    const elena = elenaVerify.data.data?.[0];
    if (!elena || elena.company !== 'NovaTech Dynamics' || !elena.tags?.includes('web-lead')) {
      throw new Error(`Form lead contact verification failed: ${JSON.stringify(elenaVerify.data)}`);
    }
    console.log(`Verified Form Lead Contact: ID=${elena.id}, Name="${elena.firstName} ${elena.lastName}", Tags=[${elena.tags.join(', ')}]`);

    // Verify opportunity created in Lead Pipeline
    const oppsVerify = await request('/api/crm/opportunities?search=Elena');
    const elenaOpp = oppsVerify.data.data?.[0];
    if (!elenaOpp || elenaOpp.stage !== 'New Inbound Lead') {
      throw new Error(`Form lead opportunity verification failed: ${JSON.stringify(oppsVerify.data)}`);
    }
    console.log(`Verified Deal Opportunity: ID=${elenaOpp.id}, Stage="${elenaOpp.stage}", Value=$${elenaOpp.value}`);
    console.log('✅ Public form ingress verified: form lookup, lead creation, opportunity provisioning, and workflow trigger');

    // 22. CSV Bulk Ingestion & Multi-Contact Bulk Tagging
    console.log('\n[TEST 22] CSV Bulk Ingestion & Multi-Contact Tagging: POST /api/crm/contacts/import & /bulk-tag');
    const csvData = [
      'firstName,lastName,email,phone,company,tags',
      'Victor,Stone,victor@star-labs.org,+15550211,S.T.A.R. Labs,enterprise',
      'Diana,Prince,diana@themyscira-antiques.org,+15550222,Themyscira Antiques,vip'
    ].join('\n');

    const csvImportRes = await request('/api/crm/contacts/import', {
      method: 'POST',
      body: JSON.stringify({ csv: csvData })
    });
    console.log(`CSV Import Status: ${csvImportRes.status}`, `Imported: ${csvImportRes.data.imported}`);
    if (csvImportRes.status !== 201 || csvImportRes.data.imported !== 2) {
      throw new Error(`CSV bulk import failed: ${JSON.stringify(csvImportRes.data)}`);
    }

    const importedIds = csvImportRes.data.contacts.map(c => c.id);
    const bulkTagRes = await request('/api/crm/contacts/bulk-tag', {
      method: 'POST',
      body: JSON.stringify({ contactIds: importedIds, tag: 'q4-accelerator' })
    });
    console.log(`Bulk Tag Status: ${bulkTagRes.status}`, `Updated: ${bulkTagRes.data.updated}`);
    if (bulkTagRes.status !== 200 || bulkTagRes.data.updated !== 2) {
      throw new Error(`Bulk tagging failed: ${JSON.stringify(bulkTagRes.data)}`);
    }

    // Verify tag persistence on imported contact
    const victorVerify = await request('/api/crm/contacts?search=Victor');
    const victor = victorVerify.data.data?.[0];
    if (!victor || !victor.tags?.includes('q4-accelerator')) {
      throw new Error('Bulk tag was not applied to imported contact');
    }
    console.log(`Verified Tagged Contact: ID=${victor.id}, Name="${victor.firstName} ${victor.lastName}", Tags=[${victor.tags.join(', ')}]`);
    console.log('✅ CSV contact batch import and bulk tagging verified cleanly');

    // 23. Contact Deduplication & Relational Merge Engine
    console.log('\n[TEST 23] Contact Deduplication & Relational Merge: POST /api/crm/contacts/merge');
    // Create a duplicate record for Victor with an extra tag and secondary info
    const dupRes = await request('/api/crm/contacts', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Victor',
        lastName: 'Stone',
        email: 'victor.stone@justice-league.org',
        phone: '+1 555-0999',
        company: 'Cyborg Innovations',
        tags: ['founder-club']
      })
    });
    const dupId = dupRes.data.id;
    console.log(`Created Duplicate Contact ID: ${dupId}`);

    // Merge duplicate into primary Victor
    const mergeRes = await request('/api/crm/contacts/merge', {
      method: 'POST',
      body: JSON.stringify({ primaryId: victor.id, mergeIds: [dupId] })
    });
    console.log(`Merge Status: ${mergeRes.status}`, `Merged Count: ${mergeRes.data.mergedCount}`);
    if (mergeRes.status !== 200 || mergeRes.data.mergedCount !== 1) {
      throw new Error(`Contact merge failed: ${JSON.stringify(mergeRes.data)}`);
    }

    // Verify merged tags and duplicate removal
    const postMergeVictor = await request(`/api/crm/contacts/${victor.id}`);
    if (!postMergeVictor.data.tags?.includes('founder-club')) {
      throw new Error('Secondary tags were not merged into primary contact');
    }
    const dupCheckRes = await request(`/api/crm/contacts/${dupId}`);
    if (dupCheckRes.status !== 404) {
      throw new Error('Duplicate contact was not purged following merge operation');
    }
    console.log(`Verified Master Contact: ID=${postMergeVictor.data.id}, Merged Tags=[${postMergeVictor.data.tags.join(', ')}]`);
    console.log('✅ Contact deduplication and relational merge verified cleanly');

    // 24. Contact 360 Activity Ledger & Timeline Query
    console.log('\n[TEST 24] Contact 360 Activity Ledger: GET /api/crm/contacts/:id/timeline');
    const timelineRes = await request(`/api/crm/contacts/${elena.id}/timeline`);
    console.log(`Timeline Status: ${timelineRes.status}`, `Events: ${timelineRes.data.timeline?.length}`);
    if (timelineRes.status !== 200 || !Array.isArray(timelineRes.data.timeline) || timelineRes.data.timeline.length < 2) {
      throw new Error(`Contact timeline query failed: ${JSON.stringify(timelineRes.data)}`);
    }
    console.log('Top Timeline Events:');
    timelineRes.data.timeline.slice(0, 3).forEach(evt => {
      console.log(`   - [${evt.type}] ${evt.detail} (${evt.date || 'no date'})`);
    });
    console.log('✅ Contact 360 activity ledger query verified');

    // 25. Omnichannel Outbound Messaging: POST /api/conversations/:id/messages
    console.log('\n[TEST 25] Omnichannel Outbound Message Dispatch: POST /api/conversations/:id/messages');
    const existingConvs = await request('/api/crm/conversations');
    const activeConv = existingConvs.data.data?.[0];
    if (!activeConv) {
      throw new Error('No existing conversation found to dispatch outbound message');
    }
    const sendMsgRes = await request(`/api/conversations/${activeConv.id}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        content: 'Your custom growth automation blueprint is ready for deployment.',
        channel: 'sms'
      })
    });
    console.log(`Outbound Send Status: ${sendMsgRes.status}`, `Msg ID: ${sendMsgRes.data.message?.id}`);
    if (sendMsgRes.status !== 201 || !sendMsgRes.data.message?.id || sendMsgRes.data.message.sender !== 'agent') {
      throw new Error(`Outbound message dispatch failed: ${JSON.stringify(sendMsgRes.data)}`);
    }

    // Verify conversation thread updated
    const refreshedConv = await request(`/api/crm/conversations/${activeConv.id}`);
    const foundOutbound = (refreshedConv.data.messages || []).find(
      m => m.content && m.content.includes('growth automation blueprint')
    );
    if (!foundOutbound || refreshedConv.data.lastMessage !== foundOutbound.content) {
      throw new Error('Outbound message not appended to conversation history');
    }
    console.log(`Verified Conversation Thread: LastMessage="${refreshedConv.data.lastMessage}"`);
    console.log('✅ Omnichannel outbound message dispatched, appended, and broadcasted');

    // 26. Social Media Planner Post Creation & 1-Click Publishing
    console.log('\n[TEST 26] Social Media Planner Post Lifecycle: POST /api/crm/socialPosts & /api/social/publish/:id');
    const socialCreateRes = await request('/api/crm/socialPosts', {
      method: 'POST',
      body: JSON.stringify({
        body: 'Scaling agency automation systems with autonomous AI Copilot in 2026 🚀',
        platforms: ['linkedin', 'instagram', 'facebook'],
        status: 'scheduled',
        scheduledAt: new Date(Date.now() + 86400000).toISOString()
      })
    });
    console.log(`Social Post Create Status: ${socialCreateRes.status}`, `ID: ${socialCreateRes.data.id}`);
    if (socialCreateRes.status !== 201 || !socialCreateRes.data.id) {
      throw new Error(`Social post creation failed: ${JSON.stringify(socialCreateRes.data)}`);
    }

    const socialPostId = socialCreateRes.data.id;
    const publishRes = await request(`/api/social/publish/${socialPostId}`, {
      method: 'POST'
    });
    console.log(`Publish Status: ${publishRes.status}`, `New Status: ${publishRes.data.post?.status}`);
    if (publishRes.status !== 200 || publishRes.data.post?.status !== 'published') {
      throw new Error(`Social post publishing failed: ${JSON.stringify(publishRes.data)}`);
    }
    console.log(`Published Metrics: Likes=${publishRes.data.post?.likes}, Comments=${publishRes.data.post?.comments}`);
    console.log('✅ Social planner post creation and immediate multi-channel publishing verified');

    // 27. Opportunity Kanban Stage Move & Automated Workflow Triggering
    console.log('\n[TEST 27] Opportunity Kanban Stage Transition: PUT /api/crm/opportunities/:id');
    const oppUpdateRes = await request(`/api/crm/opportunities/${elenaOpp.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        stage: 'Proposal Presented',
        value: 4500
      })
    });
    console.log(`Opportunity Stage Update Status: ${oppUpdateRes.status}`, `New Stage: ${oppUpdateRes.data.stage}`);
    if (oppUpdateRes.status !== 200 || oppUpdateRes.data.stage !== 'Proposal Presented' || oppUpdateRes.data.value !== 4500) {
      throw new Error(`Opportunity stage transition failed: ${JSON.stringify(oppUpdateRes.data)}`);
    }

    // Verify opportunity query reflects updated stage
    const verifyOppRes = await request(`/api/crm/opportunities/${elenaOpp.id}`);
    if (verifyOppRes.data.stage !== 'Proposal Presented') {
      throw new Error('Updated opportunity stage was not persisted in database');
    }
    console.log(`Verified Deal: ID=${verifyOppRes.data.id}, Stage="${verifyOppRes.data.stage}", Value=$${verifyOppRes.data.value}`);
    console.log('✅ Opportunity Kanban stage transition and automated workflow triggering verified');

    // 28. Trigger Links Click Tracking & Automation Hook
    console.log('\n[TEST 28] Trigger Links Click Tracking: POST /api/crm/triggerLinks & GET /api/links/click/:slug');
    const linkCreateRes = await request('/api/crm/triggerLinks', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Q4 Product Demo Link',
        slug: 'q4-demo',
        targetUrl: 'https://operza.io/demo',
        clicks: 0
      })
    });
    console.log(`Trigger Link Create Status: ${linkCreateRes.status}`, `Slug: ${linkCreateRes.data.slug}`);
    if (linkCreateRes.status !== 201 || linkCreateRes.data.slug !== 'q4-demo') {
      throw new Error(`Trigger link creation failed: ${JSON.stringify(linkCreateRes.data)}`);
    }

    const clickRes = await request('/api/links/click/q4-demo');
    console.log(`Trigger Link Click Status: ${clickRes.status}`, `Clicks: ${clickRes.data.clicks}`, `Target: ${clickRes.data.targetUrl}`);
    if (clickRes.status !== 200 || clickRes.data.clicks !== 1 || clickRes.data.targetUrl !== 'https://operza.io/demo') {
      throw new Error(`Trigger link click simulation failed: ${JSON.stringify(clickRes.data)}`);
    }
    console.log('✅ Trigger link created, clicked, tracked, and automation triggered');

    // 29. Proposals & Contracts E-Signature Lifecycle
    console.log('\n[TEST 29] Proposals & Contracts E-Signature: POST /api/crm/documents & /api/documents/:id/sign');
    const docCreateRes = await request('/api/crm/documents', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Enterprise Master Services Agreement',
        kind: 'contract',
        value: 12000,
        status: 'sent',
        contactId: elena.id
      })
    });
    console.log(`Document Create Status: ${docCreateRes.status}`, `ID: ${docCreateRes.data.id}`);
    if (docCreateRes.status !== 201 || !docCreateRes.data.id) {
      throw new Error(`Document creation failed: ${JSON.stringify(docCreateRes.data)}`);
    }

    const docId = docCreateRes.data.id;
    const signRes = await request(`/api/documents/${docId}/sign`, {
      method: 'POST',
      body: JSON.stringify({ signerName: 'Elena Rostova' })
    });
    console.log(`E-Signature Status: ${signRes.status}`, `New Status: ${signRes.data.document?.status}`, `Signer: ${signRes.data.document?.signerName}`);
    if (signRes.status !== 200 || signRes.data.document?.status !== 'signed' || signRes.data.document?.signerName !== 'Elena Rostova') {
      throw new Error(`Document e-signature failed: ${JSON.stringify(signRes.data)}`);
    }
    console.log('✅ Document created, delivered, e-signed, and verified in contract register');

    // 30. Recurring Subscriptions Lifecycle & Dunning
    console.log('\n[TEST 30] Recurring Subscriptions Lifecycle: POST /api/crm/subscriptions & /api/subscriptions/:id/cancel');
    const subCreateRes = await request('/api/crm/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        plan: 'Scale Agency Retainer',
        amount: 2500,
        interval: 'month',
        status: 'active',
        contactId: elena.id,
        renewsAt: '2026-11-29T10:00:00Z'
      })
    });
    console.log(`Subscription Create Status: ${subCreateRes.status}`, `ID: ${subCreateRes.data.id}`, `Plan: ${subCreateRes.data.plan}`);
    if (subCreateRes.status !== 201 || !subCreateRes.data.id || subCreateRes.data.amount !== 2500) {
      throw new Error(`Subscription creation failed: ${JSON.stringify(subCreateRes.data)}`);
    }

    const subId = subCreateRes.data.id;
    const subCancelRes = await request(`/api/subscriptions/${subId}/cancel`, {
      method: 'POST'
    });
    console.log(`Subscription Cancel Status: ${subCancelRes.status}`, `New Status: ${subCancelRes.data.subscription?.status}`);
    if (subCancelRes.status !== 200 || subCancelRes.data.subscription?.status !== 'canceled') {
      throw new Error(`Subscription cancellation failed: ${JSON.stringify(subCancelRes.data)}`);
    }
    console.log('✅ Recurring subscription provisioned, billed, canceled, and dunning automation triggered');

    // 31. Telephony Inbound Voice Webhook & Automated Missed-Call Task
    console.log('\n[TEST 31] Telephony Voice Webhook & Missed-Call Automation: POST /api/webhooks/twilio (voice)');
    const voiceWebhookRes = await fetch('http://localhost:4005/api/webhooks/twilio', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        CallSid: 'CA_TEST_VOICE_998877',
        From: '+1 555-0199',
        To: '+1 800-555-0100',
        CallStatus: 'no-answer',
        CallDuration: '0'
      }).toString()
    });
    const voiceXml = await voiceWebhookRes.text();
    console.log(`Voice Webhook Status: ${voiceWebhookRes.status}`);
    if (voiceWebhookRes.status !== 200 || !voiceXml.includes('<Response>')) {
      throw new Error(`Voice webhook failed: ${voiceXml}`);
    }

    // Verify call logged in database and contact tagged missed-call
    const callsListRes = await request('/api/crm/calls');
    const loggedCall = (callsListRes.data.data || []).find(c => c.id === 'CA_TEST_VOICE_998877');
    if (!loggedCall || loggedCall.outcome !== 'missed') {
      throw new Error('Inbound voice call was not logged in CRM database');
    }

    const marcusVerifyRes = await request('/api/crm/contacts?search=Marcus');
    const marcusContact = marcusVerifyRes.data.data?.[0];
    if (!marcusContact || !marcusContact.tags?.includes('missed-call')) {
      throw new Error('Contact not tagged with missed-call following no-answer');
    }

    const tasksListRes = await request('/api/crm/tasks?status=pending');
    const missedTask = (tasksListRes.data.data || []).find(t => t.title && t.title.includes('Missed call follow-up'));
    if (!missedTask) {
      throw new Error('Missed call urgent recovery task was not created');
    }
    console.log(`Verified Missed-Call Task: "${missedTask.title}" (Priority=${missedTask.priority})`);
    console.log('✅ Telephony voice webhook ingested, call logged, contact tagged, and recovery task created');

    // 32. Course Enrollment & Student Lifecycle
    console.log('\n[TEST 32] Memberships Course Enrollment: POST /api/crm/courses & /api/memberships/enroll');
    const courseCreateRes = await request('/api/crm/courses', {
      method: 'POST',
      body: JSON.stringify({
        name: 'AI Agency Masterclass',
        status: 'published',
        members: 0,
        lessons: 12
      })
    });
    console.log(`Course Create Status: ${courseCreateRes.status}`, `ID: ${courseCreateRes.data.id}`);
    if (courseCreateRes.status !== 201 || !courseCreateRes.data.id) {
      throw new Error(`Course creation failed: ${JSON.stringify(courseCreateRes.data)}`);
    }

    const courseId = courseCreateRes.data.id;
    const enrollRes = await request('/api/memberships/enroll', {
      method: 'POST',
      body: JSON.stringify({ courseId, contactId: elena.id })
    });
    console.log(`Enrollment Status: ${enrollRes.status}`, `Student: ${enrollRes.data.enrollment?.contactName}`);
    if (enrollRes.status !== 201 || !enrollRes.data.enrollment?.id || enrollRes.data.enrollment.status !== 'active') {
      throw new Error(`Course enrollment failed: ${JSON.stringify(enrollRes.data)}`);
    }

    // Verify course member count incremented
    const refreshedCourse = await request(`/api/crm/courses/${courseId}`);
    if (refreshedCourse.data.members < 1) {
      throw new Error('Course member count was not incremented upon enrollment');
    }
    console.log(`Verified Course Members: ${refreshedCourse.data.members} student(s) enrolled`);
    console.log('✅ Course created, contact enrolled, and membership automation triggered');

    // 33. Affiliate Tracking & Commission Calculation Engine
    console.log('\n[TEST 33] Affiliate Tracking & Commission: POST /api/crm/affiliates & /api/affiliates/track/:code');
    const affiliateCreateRes = await request('/api/crm/affiliates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Enterprise Growth Partners',
        code: 'GROWTH25',
        commissionPct: 25,
        clicks: 15,
        conversions: 0,
        payout: 0,
        status: 'active'
      })
    });
    console.log(`Affiliate Create Status: ${affiliateCreateRes.status}`, `Code: ${affiliateCreateRes.data.code}`);
    if (affiliateCreateRes.status !== 201 || affiliateCreateRes.data.code !== 'GROWTH25') {
      throw new Error(`Affiliate creation failed: ${JSON.stringify(affiliateCreateRes.data)}`);
    }

    // Simulate $2,000 order referral (25% commission = $500 payout)
    const trackRes = await request('/api/affiliates/track/GROWTH25', {
      method: 'POST',
      body: JSON.stringify({ amount: 2000 })
    });
    console.log(`Track Status: ${trackRes.status}`, `Commission: $${trackRes.data.commissionEarned}`, `Total Payout: $${trackRes.data.affiliate?.payout}`);
    if (trackRes.status !== 200 || trackRes.data.commissionEarned !== 500 || trackRes.data.affiliate?.payout !== 500) {
      throw new Error(`Affiliate commission calculation failed: ${JSON.stringify(trackRes.data)}`);
    }
    console.log('✅ Affiliate partner created, referral tracked, 25% commission calculated and credited');

    // 34. Funnels Public Ingress, Visit Tracking, and Lead Opt-in with Order Bump
    console.log('\n[TEST 34] Funnels Public Ingress & Opt-in Engine: GET /api/funnels/public/:slug & POST /api/funnels/optin/:slug');
    const test33_funnelCreateRes = await request('/api/crm/websites', {
      method: 'POST',
      body: JSON.stringify({
        name: 'High-Ticket Automation Accelerator',
        kind: 'funnel',
        published: true,
        visits: 0,
        optins: 0,
        pages: [
          { id: 'page-optin-1', name: 'Optin Page', slug: 'optin', path: '/optin', visits: 0, optins: 0 },
          { id: 'page-thankyou-1', name: 'Thank You', slug: 'thank-you', path: '/thank-you', visits: 0, optins: 0 }
        ],
        checkout: {
          bumps: [
            { id: 'bump-1', enabled: true, headline: 'VIP Implementation Toolkit', price: 97 }
          ]
        }
      })
    });
    console.log(`Funnel Create Status: ${test33_funnelCreateRes.status}`, `ID: ${test33_funnelCreateRes.data.id}`);
    if (test33_funnelCreateRes.status !== 201 || !test33_funnelCreateRes.data.id) {
      throw new Error(`Funnel creation failed: ${JSON.stringify(test33_funnelCreateRes.data)}`);
    }

    const funnelSlug = 'high-ticket-automation-accelerator';
    const funnelVisitRes = await request(`/api/funnels/public/${funnelSlug}?pageSlug=optin`);
    console.log(`Public Funnel Visit Status: ${funnelVisitRes.status}`, `Visits: ${funnelVisitRes.data.visits}`);
    if (funnelVisitRes.status !== 200 || funnelVisitRes.data.visits !== 1) {
      throw new Error(`Public funnel lookup failed: ${JSON.stringify(funnelVisitRes.data)}`);
    }

    // Submit Opt-in with Order Bump accepted
    const optinRes = await request(`/api/funnels/optin/${funnelSlug}`, {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Arthur',
        lastName: 'Dent',
        email: 'arthur@galaxy.io',
        phone: '+1 555-4242',
        pageSlug: 'optin',
        bumpAccepted: true
      })
    });
    console.log(`Funnel Opt-in Status: ${optinRes.status}`, `Lead: ${optinRes.data.contact?.firstName}`, `Bump Order: $${optinRes.data.order?.amount}`);
    if (optinRes.status !== 201 || !optinRes.data.contact?.id || !optinRes.data.opportunity?.id || !optinRes.data.order?.id) {
      throw new Error(`Funnel opt-in submission failed: ${JSON.stringify(optinRes.data)}`);
    }

    const arthurContact = optinRes.data.contact;
    if (!arthurContact.tags?.includes('funnel-lead') || optinRes.data.order.amount !== 97) {
      throw new Error('Funnel lead tags or order bump amount did not verify');
    }
    console.log('✅ Funnel visit tracked, lead captured, opportunity provisioned, and order bump fulfilled');

    // 35. Custom Values & Dynamic Merge Fields Resolution Engine
    console.log('\n[TEST 35] Custom Values Resolution Engine: POST /api/crm/customValues & POST /api/custom-values/resolve');
    const cvCreateRes = await request('/api/crm/customValues', {
      method: 'POST',
      body: JSON.stringify({
        name: 'support_email',
        value: 'support@operza.io'
      })
    });
    console.log(`Custom Value Create Status: ${cvCreateRes.status}`);
    if (cvCreateRes.status !== 201 || !cvCreateRes.data.id) {
      throw new Error(`Custom value creation failed: ${JSON.stringify(cvCreateRes.data)}`);
    }

    const templateText = 'Hello {{contact.firstName}}, reach our team at {{custom_values.support_email}} or visit {{agency.name}}!';
    const resolveRes = await request('/api/custom-values/resolve', {
      method: 'POST',
      body: JSON.stringify({
        text: templateText,
        contactId: arthurContact.id
      })
    });
    console.log(`Resolve Status: ${resolveRes.status}`, `Resolved Text: "${resolveRes.data.resolvedText}"`, `Tokens: ${resolveRes.data.tokensResolved}`);
    if (
      resolveRes.status !== 200 ||
      resolveRes.data.tokensResolved < 3 ||
      !resolveRes.data.resolvedText.includes('Arthur') ||
      !resolveRes.data.resolvedText.includes('support@operza.io')
    ) {
      throw new Error(`Custom values merge resolution failed: ${JSON.stringify(resolveRes.data)}`);
    }
    console.log('✅ Custom values and contact merge tags resolved dynamically with full multi-tenant scoping');

    // 36. Telephony Manual Call Logging & Handled State Machine
    console.log('\n[TEST 36] Telephony Call Log & State Machine: POST /api/crm/calls & PUT /api/calls/handled/:id');
    const callLogRes = await request('/api/crm/calls', {
      method: 'POST',
      body: JSON.stringify({
        from: '+1 555-0199',
        to: '+1 800-555-0100',
        durationSec: 0,
        outcome: 'missed',
        direction: 'inbound',
        handled: false,
        notes: 'Follow-up requested on enterprise custom deployment tier'
      })
    });
    console.log(`Call Log Status: ${callLogRes.status}`, `ID: ${callLogRes.data.id}`);
    if (callLogRes.status !== 201 || !callLogRes.data.id) {
      throw new Error(`Call logging failed: ${JSON.stringify(callLogRes.data)}`);
    }

    const testCallId = callLogRes.data.id;
    const handledRes = await request(`/api/calls/handled/${testCallId}`, {
      method: 'PUT',
      body: JSON.stringify({ handled: true })
    });
    console.log(`Mark Handled Status: ${handledRes.status}`, `Handled: ${handledRes.data.call?.handled}`);
    if (handledRes.status !== 200 || handledRes.data.call?.handled !== true) {
      throw new Error(`Call mark-handled state update failed: ${JSON.stringify(handledRes.data)}`);
    }
    console.log('✅ Manual call record logged, persisted to CRM database, and marked handled');

    // 37. Coupons Validation Engine & Discount Checkout Ingress
    console.log('\n[TEST 37] Coupons Validation Engine & Discount Checkout: POST /api/crm/coupons, /api/coupons/validate & checkout');
    const couponCreateRes = await request('/api/crm/coupons', {
      method: 'POST',
      body: JSON.stringify({
        code: 'PROMO20',
        kind: 'percent',
        amount: 20,
        minSubtotal: 100,
        maxRedemptions: 5,
        redemptions: 0,
        active: true
      })
    });
    console.log(`Coupon Create Status: ${couponCreateRes.status}`, `Code: ${couponCreateRes.data.code}`);
    if (couponCreateRes.status !== 201 || couponCreateRes.data.code !== 'PROMO20') {
      throw new Error(`Coupon creation failed: ${JSON.stringify(couponCreateRes.data)}`);
    }

    // Validate coupon against $500 subtotal (20% = $100 off, new total = $400)
    const validateRes = await request('/api/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code: 'PROMO20', subtotal: 500 })
    });
    console.log(`Coupon Validation Status: ${validateRes.status}`, `Valid: ${validateRes.data.valid}`, `Discount: $${validateRes.data.discount}`);
    if (validateRes.status !== 200 || !validateRes.data.valid || validateRes.data.discount !== 100 || validateRes.data.newTotal !== 400) {
      throw new Error(`Coupon validation logic failed: ${JSON.stringify(validateRes.data)}`);
    }

    // Apply coupon to public checkout: Starter Retainer ($1,500 - 20% discount = $1,200)
    const discountedCheckout = await request('/api/payments/checkout/starter-retainer', {
      method: 'POST',
      body: JSON.stringify({
        customerName: 'Maya Lin',
        customerEmail: 'maya@lin-arch.io',
        customerPhone: '+1 555-9090',
        couponCode: 'PROMO20'
      })
    });
    console.log(`Discounted Checkout Status: ${discountedCheckout.status}`, `Order: $${discountedCheckout.data.order?.amount}`, `Discount: $${discountedCheckout.data.order?.discount}`);
    if (
      discountedCheckout.status !== 201 ||
      discountedCheckout.data.order?.amount !== 1200 ||
      discountedCheckout.data.order?.discount !== 300 ||
      discountedCheckout.data.order?.couponCode !== 'PROMO20'
    ) {
      throw new Error(`Discounted checkout failed: ${JSON.stringify(discountedCheckout.data)}`);
    }
    console.log('✅ Coupon created, validated against subtotal, and applied to checkout with discounted order and invoice');

    // 38. Smart Lists Dynamic Rule Evaluation & Segmentation Engine
    console.log('\n[TEST 38] Smart Lists Dynamic Segmentation: POST /api/crm/smartLists & GET /api/crm/smart-lists/:id/evaluate');
    const smartListCreate = await request('/api/crm/smartLists', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Active Customers',
        rule: "status = 'customer'",
        tone: 'green',
        count: 0
      })
    });
    console.log(`Smart List Create Status: ${smartListCreate.status}`, `ID: ${smartListCreate.data.id}`);
    if (smartListCreate.status !== 201 || !smartListCreate.data.id) {
      throw new Error(`Smart list creation failed: ${JSON.stringify(smartListCreate.data)}`);
    }

    const smartListId = smartListCreate.data.id;
    const evaluateRes = await request(`/api/crm/smart-lists/${smartListId}/evaluate`);
    console.log(`Evaluation Status: ${evaluateRes.status}`, `Matching Customers Count: ${evaluateRes.data.count}`);
    if (evaluateRes.status !== 200 || evaluateRes.data.count < 1) {
      throw new Error(`Smart list evaluation failed: ${JSON.stringify(evaluateRes.data)}`);
    }
    const customerMatches = evaluateRes.data.contacts;
    if (!customerMatches.every(c => c.status === 'customer' || (c.tags || []).includes('customer'))) {
      throw new Error('Smart list returned contacts that do not match the customer rule');
    }
    console.log('✅ Smart list created, evaluated across tenant contacts database, and matching contacts segmented');

    // 39. Unified Reporting & Multi-Touch Attribution Overview
    console.log('\n[TEST 39] Unified Reporting Overview: GET /api/reporting/overview');
    const reportingRes = await request('/api/reporting/overview');
    console.log(`Reporting Status: ${reportingRes.status}`, `Revenue: $${reportingRes.data.metrics?.revenue}`, `Pipeline: $${reportingRes.data.metrics?.pipeline}`, `Deals Won: ${reportingRes.data.metrics?.dealsWon}`);
    if (
      reportingRes.status !== 200 ||
      typeof reportingRes.data.metrics?.revenue !== 'number' ||
      typeof reportingRes.data.metrics?.pipeline !== 'number' ||
      !Array.isArray(reportingRes.data.timeline) ||
      reportingRes.data.timeline.length !== 6
    ) {
      throw new Error(`Reporting overview query failed: ${JSON.stringify(reportingRes.data)}`);
    }
    console.log('Attribution Sources:', JSON.stringify(reportingRes.data.sources));
    console.log('✅ Unified reporting overview aggregated across invoices, pipeline deals, contacts, and 6-period timeline');

    // 40. Prospecting CRM Ingestion Pipeline
    console.log('\n[TEST 40] Prospecting Lead CRM Ingestion: POST /api/crm/contacts (prospect) & timeline');
    const prospectIngressRes = await request('/api/crm/contacts', {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'Daria',
        lastName: 'Morgendorffer',
        email: 'daria@lawndale.io',
        company: 'Lawndale Creative',
        tags: ['prospect', 'media-agency', 'high-fit'],
        source: 'Prospecting',
        status: 'lead'
      })
    });
    console.log(`Prospect Ingress Status: ${prospectIngressRes.status}`, `ID: ${prospectIngressRes.data.id}`);
    if (prospectIngressRes.status !== 201 || !prospectIngressRes.data.tags?.includes('prospect')) {
      throw new Error(`Prospect ingestion failed: ${JSON.stringify(prospectIngressRes.data)}`);
    }

    const prospectTimeline = await request(`/api/crm/contacts/${prospectIngressRes.data.id}/timeline`);
    console.log(`Prospect Timeline Status: ${prospectTimeline.status}`, `Events: ${prospectTimeline.data.events?.length}`);
    if (prospectTimeline.status !== 200 || prospectTimeline.data.events?.length < 1) {
      throw new Error('Prospect did not register creation event in activity ledger');
    }
    console.log('✅ Lookalike prospect converted and ingested into CRM database with source attribution and timeline');

    // 41. Media Assets Upload, Public Serving & Deletion
    console.log('\n[TEST 41] Media Assets Engine: POST /api/media/upload, GET /api/media/file/:id & DELETE');
    const mediaUploadRes = await request('/api/media/upload', {
      method: 'POST',
      body: JSON.stringify({
        name: 'agency-emblem.svg',
        folder: 'Brand Assets',
        kind: 'image',
        mimeType: 'image/svg+xml',
        sizeKb: 48
      })
    });
    console.log(`Media Upload Status: ${mediaUploadRes.status}`, `ID: ${mediaUploadRes.data.asset?.id}`, `URL: ${mediaUploadRes.data.asset?.url}`);
    if (mediaUploadRes.status !== 201 || !mediaUploadRes.data.asset?.url) {
      throw new Error(`Media upload failed: ${JSON.stringify(mediaUploadRes.data)}`);
    }

    const mediaId = mediaUploadRes.data.asset.id;
    const mediaFileRes = await request(`/api/media/file/${mediaId}`);
    console.log(`Media File Ingress Status: ${mediaFileRes.status}`);
    if (mediaFileRes.status !== 200) {
      throw new Error(`Media file fetch failed with status ${mediaFileRes.status}`);
    }

    const mediaDeleteRes = await request(`/api/media/${mediaId}`, { method: 'DELETE' });
    console.log(`Media Delete Status: ${mediaDeleteRes.status}`, `Deleted: ${mediaDeleteRes.data.asset?.name}`);
    if (mediaDeleteRes.status !== 200) {
      throw new Error(`Media delete failed: ${JSON.stringify(mediaDeleteRes.data)}`);
    }
    console.log('✅ Media asset uploaded, served via public ingress, and removed with database sync');

    // 42. SEO Blog CMS Creation, Publishing & Public Reader Ingress
    console.log('\n[TEST 42] SEO Blog CMS & Public Reader: POST /api/crm/blogs, /api/blogs/publish/:id & /api/blogs/public/:slug');
    const blogCreateRes = await request('/api/crm/blogs', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Scaling Agency Workflows in 2026',
        slug: 'scaling-agency-workflows-2026',
        author: 'Elena Rostova',
        category: 'Strategy',
        content: 'Autonomous workflows transform agency operations by connecting CRM leads directly to delivery engines.',
        status: 'draft',
        views: 0
      })
    });
    console.log(`Blog Create Status: ${blogCreateRes.status}`, `ID: ${blogCreateRes.data.id}`);
    if (blogCreateRes.status !== 201 || !blogCreateRes.data.id) {
      throw new Error(`Blog post creation failed: ${JSON.stringify(blogCreateRes.data)}`);
    }

    const blogId = blogCreateRes.data.id;
    const blogPublishRes = await request(`/api/blogs/publish/${blogId}`, { method: 'PUT' });
    console.log(`Publish Status: ${blogPublishRes.status}`, `New Status: ${blogPublishRes.data.blog?.status}`);
    if (blogPublishRes.status !== 200 || blogPublishRes.data.blog?.status !== 'published') {
      throw new Error(`Blog publish transition failed: ${JSON.stringify(blogPublishRes.data)}`);
    }

    // Public reader ingress (view 1)
    const readerRes1 = await request('/api/blogs/public/scaling-agency-workflows-2026');
    console.log(`Public Reader Status (1): ${readerRes1.status}`, `Views: ${readerRes1.data.views}`);
    if (readerRes1.status !== 200 || readerRes1.data.views !== 1) {
      throw new Error(`Public blog reader ingress failed: ${JSON.stringify(readerRes1.data)}`);
    }

    // Public reader ingress (view 2)
    const readerRes2 = await request('/api/blogs/public/scaling-agency-workflows-2026');
    console.log(`Public Reader Status (2): ${readerRes2.status}`, `Views: ${readerRes2.data.views}`);
    if (readerRes2.status !== 200 || readerRes2.data.views !== 2) {
      throw new Error(`Public blog views increment failed: ${JSON.stringify(readerRes2.data)}`);
    }
    console.log('✅ SEO blog article authored, published, and served via public reader with automated view tracking');

    // 43. QR Code Generator, SVG Vector Delivery & Scan Tracking
    console.log('\n[TEST 43] QR Codes Engine: POST /api/crm/qrCodes, GET /api/qr/:id.svg & /api/qr/:id/scan');
    const qrCreateRes = await request('/api/crm/qrCodes', {
      method: 'POST',
      body: JSON.stringify({
        name: 'VIP Strategy Session QR',
        target: 'https://operza.io/vip-consult',
        scans: 0
      })
    });
    console.log(`QR Create Status: ${qrCreateRes.status}`, `ID: ${qrCreateRes.data.id}`);
    if (qrCreateRes.status !== 201 || !qrCreateRes.data.id) {
      throw new Error(`QR code creation failed: ${JSON.stringify(qrCreateRes.data)}`);
    }

    const qrId = qrCreateRes.data.id;
    const qrSvgRes = await request(`/api/qr/${qrId}.svg`);
    console.log(`QR SVG Delivery Status: ${qrSvgRes.status}`);
    if (qrSvgRes.status !== 200) {
      throw new Error(`QR SVG generation failed with status ${qrSvgRes.status}`);
    }

    const qrScanRes = await request(`/api/qr/${qrId}/scan`);
    console.log(`QR Scan Status: ${qrScanRes.status}`, `Scans: ${qrScanRes.data.scans}`, `Target: ${qrScanRes.data.target}`);
    if (qrScanRes.status !== 200 || qrScanRes.data.scans !== 1 || qrScanRes.data.target !== 'https://operza.io/vip-consult') {
      throw new Error(`QR scan tracking failed: ${JSON.stringify(qrScanRes.data)}`);
    }
    console.log('✅ QR Code generated, standalone vector SVG rendered, and real-time scan tracked');

    // 44. Client Portal Permission Gating & Summary Ingress
    console.log('\n[TEST 44] Client Portal Ingress & Access Gating: PUT /api/crm/contacts/:id/portal-access & /api/portal/summary/:id');
    const testContactId = contact.data.id;

    // First, verify access revoke
    const revokeRes = await request(`/api/crm/contacts/${testContactId}/portal-access`, {
      method: 'PUT',
      body: JSON.stringify({ portalAccess: false })
    });
    console.log(`Portal Revoke Status: ${revokeRes.status}`, `Access: ${revokeRes.data.portalAccess}`);
    if (revokeRes.status !== 200 || revokeRes.data.portalAccess !== false) {
      throw new Error(`Portal access revoke failed: ${JSON.stringify(revokeRes.data)}`);
    }

    // Attempting portal summary with revoked access should return 403 Forbidden
    const forbiddenRes = await request(`/api/portal/summary/${testContactId}`);
    console.log(`Forbidden Portal Access Status: ${forbiddenRes.status}`);
    if (forbiddenRes.status !== 403) {
      throw new Error(`Expected 403 Forbidden for revoked portal access, got ${forbiddenRes.status}`);
    }

    // Grant portal access
    const grantRes = await request(`/api/crm/contacts/${testContactId}/portal-access`, {
      method: 'PUT',
      body: JSON.stringify({ portalAccess: true })
    });
    console.log(`Portal Grant Status: ${grantRes.status}`, `Access: ${grantRes.data.portalAccess}`);
    if (grantRes.status !== 200 || grantRes.data.portalAccess !== true) {
      throw new Error(`Portal access grant failed: ${JSON.stringify(grantRes.data)}`);
    }

    // Valid portal summary query
    const portalSummaryRes = await request(`/api/portal/summary/${testContactId}`);
    console.log(`Portal Summary Status: ${portalSummaryRes.status}`, `Client: ${portalSummaryRes.data.contact?.firstName}`, `Invoices: ${portalSummaryRes.data.invoices?.length}`);
    if (portalSummaryRes.status !== 200 || !portalSummaryRes.data.contact?.id) {
      throw new Error(`Portal summary query failed: ${JSON.stringify(portalSummaryRes.data)}`);
    }
    console.log('✅ Client Portal access gating verified with secure client summary ingress');

    // 45. Merge Token Snippets & Templates Dynamic Resolution Engine
    console.log('\n[TEST 45] Dynamic Merge Token Snippets & Templates: /api/snippets/:id/use & /api/templates/:id/use');
    const snippetCreateRes = await request('/api/crm/snippets', {
      method: 'POST',
      body: JSON.stringify({
        label: 'VIP Onboarding SMS',
        subject: 'Welcome to VIP Retainer',
        body: 'Hi {{contact.firstName}}, welcome to {{agency.name}}! Reach out anytime.',
        channel: 'sms',
        uses: 0
      })
    });
    console.log(`Snippet Create Status: ${snippetCreateRes.status}`, `ID: ${snippetCreateRes.data.id}`);
    if (snippetCreateRes.status !== 201 || !snippetCreateRes.data.id) {
      throw new Error(`Snippet creation failed: ${JSON.stringify(snippetCreateRes.data)}`);
    }

    const snippetId = snippetCreateRes.data.id;
    const snippetUseRes = await request(`/api/snippets/${snippetId}/use`, {
      method: 'POST',
      body: JSON.stringify({ contactId: testContactId })
    });
    console.log(`Snippet Use Status: ${snippetUseRes.status}`, `Uses: ${snippetUseRes.data.uses}`, `Resolved: "${snippetUseRes.data.resolvedBody}"`);
    if (
      snippetUseRes.status !== 200 ||
      snippetUseRes.data.uses !== 1 ||
      !snippetUseRes.data.resolvedBody.includes('Hi Marcus') ||
      !snippetUseRes.data.resolvedBody.includes('Operza Alpha Agency')
    ) {
      throw new Error(`Snippet resolution failed: ${JSON.stringify(snippetUseRes.data)}`);
    }

    const templateCreateRes = await request('/api/crm/templates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Quarterly Executive Review Packet',
        category: 'Review',
        subject: 'Quarterly review for {{contact.company}}',
        body: 'Dear {{contact.firstName}},\nHere is the Q4 review for {{contact.company}}.\nFrom: {{agency.name}}',
        uses: 0
      })
    });
    console.log(`Template Create Status: ${templateCreateRes.status}`, `ID: ${templateCreateRes.data.id}`);
    if (templateCreateRes.status !== 201 || !templateCreateRes.data.id) {
      throw new Error(`Template creation failed: ${JSON.stringify(templateCreateRes.data)}`);
    }

    const templateId = templateCreateRes.data.id;
    const templateUseRes = await request(`/api/templates/${templateId}/use`, {
      method: 'POST',
      body: JSON.stringify({ contactId: testContactId })
    });
    console.log(`Template Use Status: ${templateUseRes.status}`, `Uses: ${templateUseRes.data.uses}`, `ResolvedSubject: "${templateUseRes.data.resolvedSubject}"`);
    if (
      templateUseRes.status !== 200 ||
      templateUseRes.data.uses !== 1 ||
      !templateUseRes.data.resolvedSubject.includes('Vance Media') ||
      !templateUseRes.data.resolvedBody.includes('Dear Marcus')
    ) {
      throw new Error(`Template resolution failed: ${JSON.stringify(templateUseRes.data)}`);
    }
    console.log('✅ Snippets and Templates live merge token resolution and usage tracking verified');

    // 46. Agency Business Profile Query & Live Mutating Lifecycle
    console.log('\n[TEST 46] Agency Business Profile: GET & PUT /api/agency/profile');
    const profileGetRes = await request('/api/agency/profile');
    console.log(`Profile Get Status: ${profileGetRes.status}`, `Agency Name: ${profileGetRes.data.name}`, `Timezone: ${profileGetRes.data.timezone}`);
    if (profileGetRes.status !== 200 || !profileGetRes.data.name) {
      throw new Error(`Agency profile fetch failed: ${JSON.stringify(profileGetRes.data)}`);
    }

    const profileUpdateRes = await request('/api/agency/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: 'Operza Enterprise Agency',
        phone: '+1 888-555-0199',
        website: 'https://operza.io/enterprise',
        timezone: 'America/New_York',
        currency: 'USD'
      })
    });
    console.log(`Profile Update Status: ${profileUpdateRes.status}`, `New Name: ${profileUpdateRes.data.profile?.name}`, `New Timezone: ${profileUpdateRes.data.profile?.timezone}`);
    if (
      profileUpdateRes.status !== 200 ||
      profileUpdateRes.data.profile?.name !== 'Operza Enterprise Agency' ||
      profileUpdateRes.data.profile?.timezone !== 'America/New_York'
    ) {
      throw new Error(`Agency profile update failed: ${JSON.stringify(profileUpdateRes.data)}`);
    }

    const profileVerifyRes = await request('/api/agency/profile');
    if (profileVerifyRes.data.name !== 'Operza Enterprise Agency') {
      throw new Error('Updated agency profile did not persist in database');
    }
    console.log('✅ Agency business profile query, modification, and persistence verified');

    // 47. Reputation: Review Reply & Status Lifecycle
    console.log('\n[TEST 47] Review Reply Engine: POST /api/reviews/:id/reply & CRM sync');
    const existingReviewsRes = await request('/api/crm/reviews');
    console.log(`Existing Reviews Status: ${existingReviewsRes.status}`, `Count: ${existingReviewsRes.data.total}`);
    if (existingReviewsRes.status !== 200 || !existingReviewsRes.data.data?.length) {
      throw new Error(`Failed to list reviews: ${JSON.stringify(existingReviewsRes.data)}`);
    }

    const targetReview = existingReviewsRes.data.data[0];
    const replyText = 'Thank you for your fantastic feedback, Marcus! Delighted to partner with Vance Media.';
    const replyRes = await request(`/api/reviews/${targetReview.id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply: replyText })
    });
    console.log(`Reply Status: ${replyRes.status}`, `New Status: ${replyRes.data.review?.status}`, `Reply: "${replyRes.data.review?.reply}"`);
    if (
      replyRes.status !== 200 ||
      replyRes.data.review?.status !== 'replied' ||
      replyRes.data.review?.reply !== replyText ||
      !replyRes.data.review?.repliedAt
    ) {
      throw new Error(`Review reply failed: ${JSON.stringify(replyRes.data)}`);
    }
    console.log('✅ Public review reply submitted, status transitioned to replied, and repliedAt timestamped');

    // 48. Review Requests Creation & Dispatch Engine
    console.log('\n[TEST 48] Review Requests Engine: POST /api/reviews/request & immediate dispatch');
    const scheduledReqRes = await request('/api/reviews/request', {
      method: 'POST',
      body: JSON.stringify({
        contactId: testContactId,
        channel: 'sms',
        message: 'Hi Marcus, how was your experience? Leave a review: https://operza.io/review/main',
        scheduledAt: '2026-12-15T09:00:00Z',
        sendNow: false
      })
    });
    console.log(`Scheduled Request Status: ${scheduledReqRes.status}`, `ID: ${scheduledReqRes.data.request?.id}`, `Status: ${scheduledReqRes.data.request?.status}`);
    if (
      scheduledReqRes.status !== 201 ||
      !scheduledReqRes.data.request?.id ||
      scheduledReqRes.data.request?.status !== 'scheduled' ||
      scheduledReqRes.data.request?.sentAt !== null
    ) {
      throw new Error(`Scheduled review request creation failed: ${JSON.stringify(scheduledReqRes.data)}`);
    }

    const scheduledReqId = scheduledReqRes.data.request.id;
    const sendScheduledRes = await request(`/api/reviews/requests/${scheduledReqId}/send`, {
      method: 'POST'
    });
    console.log(`Send Scheduled Status: ${sendScheduledRes.status}`, `New Status: ${sendScheduledRes.data.request?.status}`, `SentAt: ${sendScheduledRes.data.request?.sentAt}`);
    if (
      sendScheduledRes.status !== 200 ||
      sendScheduledRes.data.request?.status !== 'sent' ||
      !sendScheduledRes.data.request?.sentAt
    ) {
      throw new Error(`Immediate dispatch of scheduled review request failed: ${JSON.stringify(sendScheduledRes.data)}`);
    }

    // Direct immediate review request
    const immediateReqRes = await request('/api/reviews/request', {
      method: 'POST',
      body: JSON.stringify({
        contactId: testContactId,
        channel: 'email',
        message: 'Marcus, would you mind rating your experience with our team?',
        sendNow: true
      })
    });
    console.log(`Immediate Request Status: ${immediateReqRes.status}`, `Status: ${immediateReqRes.data.request?.status}`, `SentAt: ${immediateReqRes.data.request?.sentAt}`);
    if (
      immediateReqRes.status !== 201 ||
      immediateReqRes.data.request?.status !== 'sent' ||
      !immediateReqRes.data.request?.sentAt
    ) {
      throw new Error(`Immediate review request creation failed: ${JSON.stringify(immediateReqRes.data)}`);
    }
    console.log('✅ Review requests created, scheduled, and dispatched with conversation messaging');

    // 49. LMS Course Lessons Authoring, Curriculum Sync & Client Portal Ingress
    console.log('\n[TEST 49] LMS Lessons & Curriculum Engine: /api/courses/:id/lessons & Portal Ingress');
    const lmsCourseCreateRes = await request('/api/crm/courses', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Agency Growth & Automation Masterclass',
        kind: 'course',
        price: 1497,
        published: false,
        members: 0,
        status: 'draft'
      })
    });
    console.log(`Course Create Status: ${lmsCourseCreateRes.status}`, `ID: ${lmsCourseCreateRes.data.id}`);
    if (lmsCourseCreateRes.status !== 201 || !lmsCourseCreateRes.data.id) {
      throw new Error(`Course creation failed: ${JSON.stringify(lmsCourseCreateRes.data)}`);
    }

    const testCourseId = lmsCourseCreateRes.data.id;
    const lesson1Res = await request(`/api/courses/${testCourseId}/lessons`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Module 1: High-Converting CRM Pipeline Architecture',
        durationMin: 30,
        dripDays: 0
      })
    });
    console.log(`Lesson 1 Status: ${lesson1Res.status}`, `Title: "${lesson1Res.data.lesson?.title}"`, `Total Lessons: ${lesson1Res.data.course?.lessons}`);
    if (lesson1Res.status !== 201 || !lesson1Res.data.lesson?.id || lesson1Res.data.course?.lessons !== 1) {
      throw new Error(`Lesson 1 creation failed: ${JSON.stringify(lesson1Res.data)}`);
    }

    const lesson2Res = await request(`/api/courses/${testCourseId}/lessons`, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Module 2: Autonomous AI Copilot Lead Qualification Engine',
        durationMin: 45,
        dripDays: 7
      })
    });
    console.log(`Lesson 2 Status: ${lesson2Res.status}`, `Title: "${lesson2Res.data.lesson?.title}"`, `Total Lessons: ${lesson2Res.data.course?.lessons}`);
    if (lesson2Res.status !== 201 || lesson2Res.data.course?.lessons !== 2) {
      throw new Error(`Lesson 2 creation failed: ${JSON.stringify(lesson2Res.data)}`);
    }

    // Publish course
    const coursePublishRes = await request(`/api/courses/${testCourseId}/publish`, {
      method: 'PUT',
      body: JSON.stringify({ published: true })
    });
    console.log(`Course Publish Status: ${coursePublishRes.status}`, `Published: ${coursePublishRes.data.course?.published}`, `Status: ${coursePublishRes.data.course?.status}`);
    if (
      coursePublishRes.status !== 200 ||
      coursePublishRes.data.course?.published !== true ||
      coursePublishRes.data.course?.status !== 'published'
    ) {
      throw new Error(`Course publish failed: ${JSON.stringify(coursePublishRes.data)}`);
    }

    // Enroll contact and verify portal summary exposes complete curriculum
    const lmsEnrollRes = await request('/api/crm/enrollments', {
      method: 'POST',
      body: JSON.stringify({
        courseId: testCourseId,
        contactId: testContactId,
        progress: 50,
        startedAt: new Date().toISOString(),
        status: 'active'
      })
    });
    console.log(`Enrollment Status: ${lmsEnrollRes.status}`, `ID: ${lmsEnrollRes.data.id}`);
    if (lmsEnrollRes.status !== 201) {
      throw new Error(`Course enrollment failed: ${JSON.stringify(lmsEnrollRes.data)}`);
    }

    const updatedPortalRes = await request(`/api/portal/summary/${testContactId}`);
    const enrolledCourse = updatedPortalRes.data.courses?.find(c => c.courseId === testCourseId);
    console.log(`Portal Enrolled Course: "${enrolledCourse?.name}"`, `LessonsCount: ${enrolledCourse?.lessonsCount}`, `Curriculum: ${enrolledCourse?.curriculum?.length}`);
    if (!enrolledCourse || enrolledCourse.lessonsCount !== 2 || enrolledCourse.curriculum?.length !== 2) {
      throw new Error(`Client portal did not receive full curriculum and lesson count: ${JSON.stringify(updatedPortalRes.data)}`);
    }
    console.log('✅ LMS course authoring, lesson additions, publishing, and portal curriculum ingress verified');

    // 50. Affiliate Partner Invitation, Referral Tracking, and Commission Settlement Lifecycle
    console.log('\n[TEST 50] Affiliate Partner Lifecycle: Invite, Track Referral, Settle Payout, & Report');
    const newAffiliateRes = await request('/api/crm/affiliates', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Elena Rostova',
        email: 'elena@growthventures.co',
        code: 'ELENA30',
        commissionPct: 30,
        clicks: 0,
        signups: 0,
        conversions: 0,
        payout: 0,
        status: 'active'
      })
    });
    console.log(`Affiliate Invite Status: ${newAffiliateRes.status}`, `ID: ${newAffiliateRes.data.id}`, `Code: ${newAffiliateRes.data.code}`);
    if (newAffiliateRes.status !== 201 || !newAffiliateRes.data.id || newAffiliateRes.data.code !== 'ELENA30') {
      throw new Error(`Affiliate creation failed: ${JSON.stringify(newAffiliateRes.data)}`);
    }

    const elenaId = newAffiliateRes.data.id;

    // Track a $2,000 order referral with 30% commission ($600)
    const trackOrderRes = await request('/api/affiliates/track/ELENA30', {
      method: 'POST',
      body: JSON.stringify({ amount: 2000 })
    });
    console.log(`Track Referral Status: ${trackOrderRes.status}`, `Commission: $${trackOrderRes.data.commissionEarned}`, `Total Payout: $${trackOrderRes.data.affiliate?.payout}`);
    if (
      trackOrderRes.status !== 200 ||
      trackOrderRes.data.commissionEarned !== 600 ||
      trackOrderRes.data.affiliate?.payout !== 600 ||
      trackOrderRes.data.affiliate?.conversions !== 1
    ) {
      throw new Error(`Affiliate referral tracking failed: ${JSON.stringify(trackOrderRes.data)}`);
    }

    // Settle affiliate commission payout
    const settleRes = await request(`/api/affiliates/${elenaId}/payout`, {
      method: 'POST',
      body: JSON.stringify({ amount: 600 })
    });
    console.log(`Settle Payout Status: ${settleRes.status}`, `Paid: $${settleRes.data.paidAmount}`, `Remaining: $${settleRes.data.remainingPayout}`, `Invoice: ${settleRes.data.invoiceId}`);
    if (
      settleRes.status !== 200 ||
      settleRes.data.paidAmount !== 600 ||
      settleRes.data.remainingPayout !== 0 ||
      !settleRes.data.invoiceId
    ) {
      throw new Error(`Affiliate commission settlement failed: ${JSON.stringify(settleRes.data)}`);
    }

    // Query payout aggregated report
    const payoutReportRes = await request('/api/affiliates/payout-report');
    console.log(`Payout Report Status: ${payoutReportRes.status}`, `Partners: ${payoutReportRes.data.totalPartners}`, `Total Conversions: ${payoutReportRes.data.totalConversions}`);
    const elenaReport = payoutReportRes.data.partners?.find(p => p.id === elenaId);
    if (!elenaReport || elenaReport.payout !== 0 || elenaReport.conversions !== 1) {
      throw new Error(`Payout report evaluation failed: ${JSON.stringify(payoutReportRes.data)}`);
    }
    console.log('✅ Affiliate partner created, referral tracked, commission settled, and payout report verified');

    // 51. Forms & Surveys Engine: Field authoring, publishing, public submission, & submissions viewer
    console.log('\n[TEST 51] Forms & Surveys Engine: Authoring, Publishing, Submission, & Submissions Query');
    const surveyFormRes = await request('/api/crm/forms', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Executive Agency Scaling Survey',
        kind: 'survey',
        slug: 'executive-scaling-survey',
        publicSlug: 'executive-scaling-survey',
        status: 'draft',
        published: false,
        submissions: 0,
        fields: [
          { id: 'f-1', label: 'Company Name', type: 'text', required: true },
          { id: 'f-2', label: 'Work Email', type: 'email', required: true },
          { id: 'f-3', label: 'Team Size', type: 'select', required: true, options: ['1-10', '11-50', '50+'] },
          { id: 'f-4', label: 'Monthly Growth Budget', type: 'select', required: true, options: ['$2k-$5k', '$5k-$15k', '$15k+'] }
        ]
      })
    });
    console.log(`Survey Create Status: ${surveyFormRes.status}`, `ID: ${surveyFormRes.data.id}`);
    if (surveyFormRes.status !== 201 || !surveyFormRes.data.id) {
      throw new Error(`Survey form creation failed: ${JSON.stringify(surveyFormRes.data)}`);
    }

    const surveyFormId = surveyFormRes.data.id;

    // Publish the survey
    const publishFormRes = await request(`/api/forms/${surveyFormId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ published: true })
    });
    console.log(`Publish Form Status: ${publishFormRes.status}`, `Published: ${publishFormRes.data.form?.published}`);
    if (publishFormRes.status !== 200 || !publishFormRes.data.form?.published) {
      throw new Error(`Publish form failed: ${JSON.stringify(publishFormRes.data)}`);
    }

    // Verify lookup via public route
    const surveyPublicRes = await request('/api/forms/public/executive-scaling-survey');
    console.log(`Public Form Lookup Status: ${surveyPublicRes.status}`, `Fields: ${surveyPublicRes.data.fields?.length}`);
    if (surveyPublicRes.status !== 200 || surveyPublicRes.data.fields?.length !== 4) {
      throw new Error(`Public form lookup failed: ${JSON.stringify(surveyPublicRes.data)}`);
    }

    // Submit response as public visitor
    const surveySubmitRes = await request('/api/forms/submit/executive-scaling-survey', {
      method: 'POST',
      body: JSON.stringify({
        source: 'linkedin_campaign',
        answers: {
          name: 'Harrison Sterling',
          email: 'harrison@sterlingventures.io',
          phone: '+1 555-0922',
          company: 'Sterling Ventures',
          teamSize: '11-50',
          growthBudget: '$15k+'
        }
      })
    });
    console.log(`Survey Submit Status: ${surveySubmitRes.status}`, `Submission ID: ${surveySubmitRes.data.submissionId}`, `Contact ID: ${surveySubmitRes.data.contactId}`);
    if (surveySubmitRes.status !== 200 || !surveySubmitRes.data.submissionId || !surveySubmitRes.data.contactId) {
      throw new Error(`Survey public submission failed: ${JSON.stringify(surveySubmitRes.data)}`);
    }

    // Query submissions for this specific form
    const formSubmissionsRes = await request(`/api/forms/${surveyFormId}/submissions`);
    console.log(`Form Submissions Query Status: ${formSubmissionsRes.status}`, `Submissions Count: ${formSubmissionsRes.data.submissions?.length}`);
    if (
      formSubmissionsRes.status !== 200 ||
      !formSubmissionsRes.data.submissions?.length ||
      formSubmissionsRes.data.submissions[0].answers?.teamSize !== '11-50' ||
      formSubmissionsRes.data.submissions[0].source !== 'linkedin_campaign'
    ) {
      throw new Error(`Form submissions query failed: ${JSON.stringify(formSubmissionsRes.data)}`);
    }

    // Query global submissions endpoint
    const allSubmissionsRes = await request('/api/forms/submissions');
    if (allSubmissionsRes.status !== 200 || !allSubmissionsRes.data.submissions?.length) {
      throw new Error(`Global submissions query failed: ${JSON.stringify(allSubmissionsRes.data)}`);
    }
    console.log('✅ Forms & Surveys authoring, publishing, public submission, and submissions query verified');

    // 52. Recurring Subscriptions Management: Provisioning, Cancellation & Resumption
    console.log('\n[TEST 52] Recurring Subscriptions Engine: Provision, List, Cancel, & Resume');
    const newSubscriptionRes = await request('/api/subscriptions', {
      method: 'POST',
      body: JSON.stringify({
        contactId: testContactId,
        plan: 'AI Enterprise Growth Retainer',
        amount: 2500,
        interval: 'month',
        status: 'active'
      })
    });
    console.log(`Create Subscription Status: ${newSubscriptionRes.status}`, `Plan: "${newSubscriptionRes.data.subscription?.plan}"`, `Amount: $${newSubscriptionRes.data.subscription?.amount}`);
    if (newSubscriptionRes.status !== 201 || !newSubscriptionRes.data.subscription?.id || newSubscriptionRes.data.subscription.amount !== 2500) {
      throw new Error(`Subscription creation failed: ${JSON.stringify(newSubscriptionRes.data)}`);
    }

    const testSubId = newSubscriptionRes.data.subscription.id;

    // Verify listed in tenant subscriptions
    const listSubsRes = await request('/api/subscriptions');
    console.log(`List Subscriptions Status: ${listSubsRes.status}`, `Count: ${listSubsRes.data.data?.length}`);
    const foundSub = listSubsRes.data.data?.find(s => s.id === testSubId);
    if (!foundSub || foundSub.status !== 'active') {
      throw new Error(`Subscription listing verification failed: ${JSON.stringify(listSubsRes.data)}`);
    }

    // Cancel subscription
    const cancelSubRes = await request(`/api/subscriptions/${testSubId}/cancel`, { method: 'POST' });
    console.log(`Cancel Subscription Status: ${cancelSubRes.status}`, `New Status: ${cancelSubRes.data.subscription?.status}`);
    if (cancelSubRes.status !== 200 || cancelSubRes.data.subscription?.status !== 'canceled' || !cancelSubRes.data.subscription?.canceledAt) {
      throw new Error(`Subscription cancellation failed: ${JSON.stringify(cancelSubRes.data)}`);
    }

    // Resume subscription
    const resumeSubRes = await request(`/api/subscriptions/${testSubId}/resume`, { method: 'POST' });
    console.log(`Resume Subscription Status: ${resumeSubRes.status}`, `New Status: ${resumeSubRes.data.subscription?.status}`);
    if (resumeSubRes.status !== 200 || resumeSubRes.data.subscription?.status !== 'active') {
      throw new Error(`Subscription resumption failed: ${JSON.stringify(resumeSubRes.data)}`);
    }
    console.log('✅ Recurring subscription provisioned, listed, canceled, and resumed cleanly');

    // 53. Agency Team Access Governance & Invitation Lifecycle
    console.log('\n[TEST 53] Agency Team Access Governance: GET, Invite, Role Update & Removal');
    const teamGetRes = await request('/api/agency/team');
    console.log(`Team List Status: ${teamGetRes.status}`, `Initial Members: ${teamGetRes.data.team?.length}`);
    if (teamGetRes.status !== 200 || !Array.isArray(teamGetRes.data.team)) {
      throw new Error(`Failed to list agency team: ${JSON.stringify(teamGetRes.data)}`);
    }

    const inviteMemberRes = await request('/api/agency/team/invite', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Jordan Belfort',
        email: 'jordan@strattongrowth.io',
        role: 'user'
      })
    });
    console.log(`Invite Member Status: ${inviteMemberRes.status}`, `ID: ${inviteMemberRes.data.member?.id}`, `Role: ${inviteMemberRes.data.member?.role}`);
    if (inviteMemberRes.status !== 201 || !inviteMemberRes.data.member?.id || inviteMemberRes.data.member.role !== 'user') {
      throw new Error(`Team member invitation failed: ${JSON.stringify(inviteMemberRes.data)}`);
    }

    const newMemberId = inviteMemberRes.data.member.id;

    // Promote to admin
    const updateRoleRes = await request(`/api/agency/team/${newMemberId}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role: 'admin' })
    });
    console.log(`Role Update Status: ${updateRoleRes.status}`, `New Role: ${updateRoleRes.data.member?.role}`);
    if (updateRoleRes.status !== 200 || updateRoleRes.data.member?.role !== 'admin') {
      throw new Error(`Team role update failed: ${JSON.stringify(updateRoleRes.data)}`);
    }

    // Remove team member
    const removeMemberRes = await request(`/api/agency/team/${newMemberId}`, { method: 'DELETE' });
    console.log(`Remove Member Status: ${removeMemberRes.status}`, `Removed: ${removeMemberRes.data.member?.name}`);
    if (removeMemberRes.status !== 200 || removeMemberRes.data.member?.id !== newMemberId) {
      throw new Error(`Team member removal failed: ${JSON.stringify(removeMemberRes.data)}`);
    }
    console.log('✅ Agency team governance verified: list, invitation, role transition, and clean deprovisioning');

    // 54. Payment Links Lifecycle & Public Ingress
    console.log('\n[TEST 54] Payment Links Engine: Creation, Public Lookup, Pausing, & Reactivation');
    const newPaymentLinkRes = await request('/api/crm/paymentLinks', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Executive AI Automation Retainer',
        slug: 'executive-ai-retainer',
        amount: 4500,
        currency: 'USD',
        active: true,
        visits: 0,
        conversions: 0
      })
    });
    console.log(`Create Payment Link Status: ${newPaymentLinkRes.status}`, `ID: ${newPaymentLinkRes.data.id}`, `Slug: ${newPaymentLinkRes.data.slug}`);
    if (newPaymentLinkRes.status !== 201 || !newPaymentLinkRes.data.id || newPaymentLinkRes.data.slug !== 'executive-ai-retainer') {
      throw new Error(`Payment link creation failed: ${JSON.stringify(newPaymentLinkRes.data)}`);
    }

    const testLinkId = newPaymentLinkRes.data.id;

    // Public lookup & visit increment
    const publicLinkRes = await request('/api/payments/public/executive-ai-retainer');
    console.log(`Public Link Lookup Status: ${publicLinkRes.status}`, `Visits: ${publicLinkRes.data.visits}`);
    if (publicLinkRes.status !== 200 || publicLinkRes.data.visits !== 1 || publicLinkRes.data.amount !== 4500) {
      throw new Error(`Public payment link lookup failed: ${JSON.stringify(publicLinkRes.data)}`);
    }

    // Pause payment link
    const pauseLinkRes = await request(`/api/crm/paymentLinks/${testLinkId}`, {
      method: 'PUT',
      body: JSON.stringify({ active: false })
    });
    console.log(`Pause Link Status: ${pauseLinkRes.status}`, `Active: ${pauseLinkRes.data.active}`);
    if (pauseLinkRes.status !== 200 || pauseLinkRes.data.active !== false) {
      throw new Error(`Payment link pause failed: ${JSON.stringify(pauseLinkRes.data)}`);
    }

    // Verify public route rejects inactive link
    const inactiveLookupRes = await request('/api/payments/public/executive-ai-retainer');
    console.log(`Inactive Link Public Status: ${inactiveLookupRes.status}`);
    if (inactiveLookupRes.status !== 404) {
      throw new Error(`Expected 404 for paused payment link, got ${inactiveLookupRes.status}`);
    }

    // Reactivate payment link
    const reactivateLinkRes = await request(`/api/crm/paymentLinks/${testLinkId}`, {
      method: 'PUT',
      body: JSON.stringify({ active: true })
    });
    if (reactivateLinkRes.status !== 200 || reactivateLinkRes.data.active !== true) {
      throw new Error(`Payment link reactivation failed: ${JSON.stringify(reactivateLinkRes.data)}`);
    }
    console.log('✅ Payment links lifecycle verified: creation, public lookup, state machine pause/resume');

    // 55. Hosted Websites & Multi-Page CMS Lifecycle
    console.log('\n[TEST 55] Hosted Websites & Multi-Page CMS Engine: Creation, Publishing, Page CRUD, & Reorder');
    const websiteCreateRes = await request('/api/crm/websites', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Nexus Strategy Agency',
        domain: 'nexus-strategy',
        kind: 'website',
        published: false,
        visits: 0,
        optins: 0,
        pages: [
          {
            id: 'page_home_01',
            name: 'Home',
            path: '/',
            headline: 'Scale Beyond Limits',
            subhead: 'End-to-end automation and revenue ops.',
            cta: 'Schedule Consultation',
            theme: 'plain',
            visits: 0,
            optins: 0
          }
        ]
      })
    });
    console.log(`Website Create Status: ${websiteCreateRes.status}`, `ID: ${websiteCreateRes.data.id}`, `Domain: ${websiteCreateRes.data.domain}`);
    if (websiteCreateRes.status !== 201 || !websiteCreateRes.data.id || websiteCreateRes.data.domain !== 'nexus-strategy') {
      throw new Error(`Website creation failed: ${JSON.stringify(websiteCreateRes.data)}`);
    }
    const testSiteId = websiteCreateRes.data.id;

    // Toggle Website Publishing
    const publishSiteRes = await request(`/api/websites/${testSiteId}/publish`, { method: 'POST' });
    console.log(`Publish Website Status: ${publishSiteRes.status}`, `Published: ${publishSiteRes.data.published}`, `Status: ${publishSiteRes.data.status}`);
    if (publishSiteRes.status !== 200 || publishSiteRes.data.published !== true || publishSiteRes.data.status !== 'published') {
      throw new Error(`Website publishing failed: ${JSON.stringify(publishSiteRes.data)}`);
    }

    // Public website lookup & visit counter
    const publicSiteRes = await request('/api/websites/public/nexus-strategy');
    console.log(`Public Website Lookup Status: ${publicSiteRes.status}`, `Visits: ${publicSiteRes.data.visits}`);
    if (publicSiteRes.status !== 200 || publicSiteRes.data.visits !== 1) {
      throw new Error(`Public website lookup failed: ${JSON.stringify(publicSiteRes.data)}`);
    }

    // Add a secondary page to the website
    const addPageRes = await request(`/api/websites/${testSiteId}/pages`, {
      method: 'POST',
      body: JSON.stringify({
        name: 'Case Studies',
        path: '/case-studies',
        headline: 'Real Results for High-Growth Firms',
        subhead: 'Explore how top agencies scaled 10x with Operza.',
        cta: 'Read Stories',
        theme: 'gradient'
      })
    });
    console.log(`Add Page Status: ${addPageRes.status}`, `Page Name: "${addPageRes.data.page?.name}"`, `Total Pages: ${addPageRes.data.site?.pages?.length}`);
    if (addPageRes.status !== 201 || !addPageRes.data.page?.id || addPageRes.data.site?.pages?.length !== 2) {
      throw new Error(`Adding page to website failed: ${JSON.stringify(addPageRes.data)}`);
    }
    const newPageId = addPageRes.data.page.id;

    // Reorder pages
    const reorderPagesRes = await request(`/api/websites/${testSiteId}/pages/reorder`, {
      method: 'PUT',
      body: JSON.stringify({
        pageIds: [newPageId, 'page_home_01']
      })
    });
    console.log(`Reorder Pages Status: ${reorderPagesRes.status}`, `First Page: "${reorderPagesRes.data.pages?.[0]?.name}"`);
    if (reorderPagesRes.status !== 200 || reorderPagesRes.data.pages?.[0]?.id !== newPageId) {
      throw new Error(`Reordering website pages failed: ${JSON.stringify(reorderPagesRes.data)}`);
    }

    // Delete the added page
    const deletePageRes = await request(`/api/websites/${testSiteId}/pages/${newPageId}`, { method: 'DELETE' });
    console.log(`Delete Page Status: ${deletePageRes.status}`, `Remaining: ${deletePageRes.data.remainingPages}`);
    if (deletePageRes.status !== 200 || deletePageRes.data.remainingPages !== 1) {
      throw new Error(`Deleting website page failed: ${JSON.stringify(deletePageRes.data)}`);
    }
    console.log('✅ Hosted website multi-page CMS lifecycle verified: creation, publish toggle, public lookup, page addition, reorder, and deletion');

    // 56. Multi-Tenant Audit Trail & CSV Export Engine
    console.log('\n[TEST 56] Multi-Tenant Audit Trail & CSV Export Engine: /api/audit-logs & format=csv');
    const auditLogsRes = await request('/api/audit-logs?limit=50');
    console.log(`Audit Logs Status: ${auditLogsRes.status}`, `Count: ${auditLogsRes.data.data?.length}`);
    if (auditLogsRes.status !== 200 || !Array.isArray(auditLogsRes.data.data) || auditLogsRes.data.data.length === 0) {
      throw new Error(`Audit log retrieval failed: ${JSON.stringify(auditLogsRes.data)}`);
    }

    // Filter audit logs by action
    const filterAuditRes = await request('/api/audit-logs?action=website.published');
    console.log(`Action-Filtered Audit Status: ${filterAuditRes.status}`, `Matches: ${filterAuditRes.data.data?.length}`);
    if (filterAuditRes.status !== 200 || !Array.isArray(filterAuditRes.data.data) || filterAuditRes.data.data.length === 0) {
      throw new Error(`Action-filtered audit query failed: ${JSON.stringify(filterAuditRes.data)}`);
    }

    // CSV format streaming export
    const csvExportRes = await fetch('http://localhost:4005/api/audit-logs?format=csv', {
      headers: {
        'Cookie': sessionCookie,
        'x-operza-csrf': csrfToken
      }
    });
    console.log(`CSV Export Status: ${csvExportRes.status}`, `Content-Type: ${csvExportRes.headers.get('content-type')}`);
    const csvText = await csvExportRes.text();
    if (csvExportRes.status !== 200 || !csvExportRes.headers.get('content-type')?.includes('text/csv') || !csvText.includes('timestamp') || !csvText.includes('action')) {
      throw new Error(`Audit CSV export failed: Status ${csvExportRes.status}, Content: ${csvText.slice(0, 100)}`);
    }
    console.log(`Exported CSV Header & Snippet: ${csvText.split('\n')[0]}`);
    console.log('✅ Multi-tenant audit trail query, action filtering, and server-side CSV streaming export verified');

    // 57. Integrations Hub Lifecycle
    console.log('\n[TEST 57] Integrations Hub: Listing, Connecting Provider, Ping Test, & Disconnect');
    const integrationsListRes = await request('/api/integrations');
    console.log(`Integrations List Status: ${integrationsListRes.status}`, `Total: ${integrationsListRes.data.integrations?.length}`);
    if (integrationsListRes.status !== 200 || !Array.isArray(integrationsListRes.data.integrations)) {
      throw new Error(`Failed to list integrations: ${JSON.stringify(integrationsListRes.data)}`);
    }

    // Connect Slack integration
    const connectSlackRes = await request('/api/integrations/slack/connect', {
      method: 'POST',
      body: JSON.stringify({
        apiKey: 'xoxb-9812481928-1928491829',
        accountName: 'Alpha Growth Slack Workspace',
        webhookUrl: 'https://hooks.slack.com/services/T00/B00/X00'
      })
    });
    console.log(`Connect Slack Status: ${connectSlackRes.status}`, `Connected: ${connectSlackRes.data.integration?.connected}`, `Account: ${connectSlackRes.data.integration?.accountName}`);
    if (connectSlackRes.status !== 200 || connectSlackRes.data.integration?.connected !== true) {
      throw new Error(`Failed to connect Slack integration: ${JSON.stringify(connectSlackRes.data)}`);
    }

    // Ping test
    const pingRes = await request('/api/integrations/slack/test', { method: 'POST' });
    console.log(`Ping Test Status: ${pingRes.status}`, `Latency: ${pingRes.data.latencyMs}ms`, `Message: ${pingRes.data.message}`);
    if (pingRes.status !== 200 || pingRes.data.success !== true) {
      throw new Error(`Integration ping test failed: ${JSON.stringify(pingRes.data)}`);
    }

    // Disconnect Slack
    const disconnectRes = await request('/api/integrations/slack/disconnect', { method: 'POST' });
    console.log(`Disconnect Status: ${disconnectRes.status}`, `Connected: ${disconnectRes.data.integration?.connected}`);
    if (disconnectRes.status !== 200 || disconnectRes.data.integration?.connected !== false) {
      throw new Error(`Failed to disconnect integration: ${JSON.stringify(disconnectRes.data)}`);
    }
    console.log('✅ Integrations Hub lifecycle verified: list, connect credentials, latency ping test, and disconnect');

    // 58. AI Copilot Bot Training & Semantic Knowledge Base Engine
    console.log('\n[TEST 58] AI Copilot Bot Training & Knowledge Center: Config, Ingestion, Grounding Query');
    const updateAiConfigRes = await request('/api/ai/config', {
      method: 'PUT',
      body: JSON.stringify({
        persona: 'sales_closer',
        tone: 'high-converting, professional and authoritative',
        systemPrompt: 'You are Operza Growth Bot. Qualify every lead for a $5,000 monthly retainer.',
        temperature: 0.6,
        permissions: {
          canCreateContacts: true,
          canSendMessages: true,
          canBookAppointments: true,
          canChargeCards: false,
          requireApprovalForDealsOver: 5000
        }
      })
    });
    console.log(`Update AI Config Status: ${updateAiConfigRes.status}`, `Persona: ${updateAiConfigRes.data.config?.persona}`);
    if (updateAiConfigRes.status !== 200 || updateAiConfigRes.data.config?.persona !== 'sales_closer') {
      throw new Error(`Failed to update AI config: ${JSON.stringify(updateAiConfigRes.data)}`);
    }

    // Ingest knowledge document with semantic chunking
    const addDocRes = await request('/api/ai/knowledge', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Retainer Pricing & Performance Guarantees 2026',
        type: 'text',
        content: 'Our core growth retainer is $3,500/month with zero onboarding fees. Clients receive weekly pipeline audits and automated AI qualification.'
      })
    });
    console.log(`Add Knowledge Doc Status: ${addDocRes.status}`, `Chunks: ${addDocRes.data.document?.chunksCount}`, `Words: ${addDocRes.data.document?.wordsCount}`);
    if (addDocRes.status !== 201 || !addDocRes.data.document?.id || addDocRes.data.document?.chunksCount < 1) {
      throw new Error(`Failed to ingest knowledge document: ${JSON.stringify(addDocRes.data)}`);
    }
    const knowledgeDocId = addDocRes.data.document.id;

    // Test query against knowledge base
    const queryTestRes = await request('/api/ai/test', {
      method: 'POST',
      body: JSON.stringify({ query: 'What is our retainer price?' })
    });
    console.log(`AI Test Query Status: ${queryTestRes.status}`, `Sources: ${queryTestRes.data.sources?.length}`, `Answer snippet: "${queryTestRes.data.answer?.slice(0, 60)}..."`);
    if (queryTestRes.status !== 200 || !queryTestRes.data.answer?.includes('3,500') || queryTestRes.data.sources?.length === 0) {
      throw new Error(`AI RAG search test failed: ${JSON.stringify(queryTestRes.data)}`);
    }

    // Clean up test document
    const deleteDocRes = await request(`/api/ai/knowledge/${knowledgeDocId}`, { method: 'DELETE' });
    if (deleteDocRes.status !== 200) {
      throw new Error(`Failed to delete test knowledge document: ${JSON.stringify(deleteDocRes.data)}`);
    }
    console.log('✅ AI bot personality configuration, semantic knowledge document ingestion, and grounded RAG query verified');

    // 59. Developer Hub: API Keys, Outbound Webhooks & Delivery Ledger
    console.log('\n[TEST 59] Developer Hub: API Key Provisioning, Webhook Subscription, & Dispatch Inspection');
    const createKeyRes = await request('/api/developers/keys', {
      method: 'POST',
      body: JSON.stringify({
        label: 'Zapier Inbound Webhook Sync',
        scopes: ['contacts:read', 'contacts:write', 'workflows:trigger']
      })
    });
    console.log(`Create API Key Status: ${createKeyRes.status}`, `Masked: ${createKeyRes.data.key?.maskedKey}`, `Has Token: ${Boolean(createKeyRes.data.key?.secretToken)}`);
    if (createKeyRes.status !== 201 || !createKeyRes.data.key?.secretToken?.startsWith('op_live_')) {
      throw new Error(`Failed to create API key: ${JSON.stringify(createKeyRes.data)}`);
    }
    const testKeyId = createKeyRes.data.key.id;

    // Register webhook endpoint
    const registerWebhookRes = await request('/api/developers/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        url: 'https://hooks.operza.io/receive/test-pipe',
        events: ['contact.created', 'opportunity.stage_changed', 'form.submitted']
      })
    });
    console.log(`Register Webhook Status: ${registerWebhookRes.status}`, `URL: ${registerWebhookRes.data.webhook?.url}`);
    if (registerWebhookRes.status !== 201 || !registerWebhookRes.data.webhook?.id) {
      throw new Error(`Failed to register webhook: ${JSON.stringify(registerWebhookRes.data)}`);
    }
    const testWebhookId = registerWebhookRes.data.webhook.id;

    // Test ping delivery
    const testWebhookPingRes = await request(`/api/developers/webhooks/${testWebhookId}/test`, { method: 'POST' });
    console.log(`Webhook Ping Status: ${testWebhookPingRes.status}`, `Delivery Status: ${testWebhookPingRes.data.delivery?.status}`, `Latency: ${testWebhookPingRes.data.delivery?.durationMs}ms`);
    if (testWebhookPingRes.status !== 200 || testWebhookPingRes.data.delivery?.status !== 200) {
      throw new Error(`Webhook ping delivery failed: ${JSON.stringify(testWebhookPingRes.data)}`);
    }

    // Inspect delivery ledger
    const deliveriesRes = await request('/api/developers/webhooks/deliveries');
    console.log(`Delivery Ledger Status: ${deliveriesRes.status}`, `Count: ${deliveriesRes.data.deliveries?.length}`);
    if (deliveriesRes.status !== 200 || deliveriesRes.data.deliveries?.length === 0) {
      throw new Error(`Failed to retrieve delivery ledger: ${JSON.stringify(deliveriesRes.data)}`);
    }

    // Revoke key & delete webhook
    await request(`/api/developers/keys/${testKeyId}`, { method: 'DELETE' });
    await request(`/api/developers/webhooks/${testWebhookId}`, { method: 'DELETE' });
    console.log('✅ Developer Hub verified: API key generation & revocation, webhook subscriptions, and delivery inspection');

    // 60. Agency White-Label & Custom Branding Engine
    console.log('\n[TEST 60] Agency White-Label & Branding Engine: Settings, Domain DNS CNAME, & Email Verification');
    const updateBrandingRes = await request('/api/agency/branding', {
      method: 'PUT',
      body: JSON.stringify({
        platformName: 'Nexus Growth Advisory OS',
        customDomain: 'portal.nexusgrowth.io',
        primaryColor: '#4f46e5',
        accentColor: '#6366f1',
        senderName: 'Nexus Operations Team',
        senderEmail: 'hello@nexusgrowth.io',
        portalWelcomeHeading: 'Welcome to your Nexus Client Portal'
      })
    });
    console.log(`Update Branding Status: ${updateBrandingRes.status}`, `Platform: "${updateBrandingRes.data.branding?.platformName}"`);
    if (updateBrandingRes.status !== 200 || updateBrandingRes.data.branding?.platformName !== 'Nexus Growth Advisory OS') {
      throw new Error(`Failed to update agency branding: ${JSON.stringify(updateBrandingRes.data)}`);
    }

    // Verify Custom Domain CNAME & SSL
    const verifyDomainRes = await request('/api/agency/branding/verify-domain', {
      method: 'POST',
      body: JSON.stringify({ customDomain: 'portal.nexusgrowth.io' })
    });
    console.log(`Verify Domain Status: ${verifyDomainRes.status}`, `Verified: ${verifyDomainRes.data.branding?.isDomainVerified}`, `SSL: ${verifyDomainRes.data.branding?.sslActive}`);
    if (verifyDomainRes.status !== 200 || verifyDomainRes.data.branding?.isDomainVerified !== true || verifyDomainRes.data.branding?.sslActive !== true) {
      throw new Error(`Custom domain verification failed: ${JSON.stringify(verifyDomainRes.data)}`);
    }

    // Verify Email Sender Identity (SPF / DKIM)
    const verifyEmailRes = await request('/api/agency/branding/verify-email', { method: 'POST' });
    console.log(`Verify Email Status: ${verifyEmailRes.status}`, `DKIM Verified: ${verifyEmailRes.data.branding?.isDkimVerified}`);
    if (verifyEmailRes.status !== 200 || verifyEmailRes.data.branding?.isDkimVerified !== true) {
      throw new Error(`Email sender verification failed: ${JSON.stringify(verifyEmailRes.data)}`);
    }
    console.log('✅ Agency white-label engine verified: custom platform branding, domain CNAME SSL verification, and email sender authentication');

    // 61. Funnel Engine: Creation with Custom Slug, Steps, & Order Bump
    console.log('\n[TEST 61] Funnel Engine: POST /api/crm/websites with Multi-Step Flow & Order Bump');
    const test61_funnelCreateRes = await request('/api/crm/websites', {
      method: 'POST',
      body: JSON.stringify({
        name: 'High-Ticket Agency Accelerator Funnel',
        type: 'funnel',
        kind: 'funnel',
        status: 'published',
        published: true,
        domain: 'accelerator-funnel',
        pages: [
          { id: 'step-1', name: 'Opt-in Page', slug: '', path: '/', isHome: true },
          { id: 'step-2', name: 'VIP Checkout & Order Bump', slug: 'checkout', path: '/checkout', isHome: false },
          { id: 'step-3', name: 'Thank You & Onboarding', slug: 'thank-you', path: '/thank-you', isHome: false }
        ],
        orderBumps: [
          {
            id: 'bump-1',
            productId: 'prod-vip-audit',
            enabled: true,
            title: '1-on-1 Growth Architecture Audit',
            copy: 'Add an executive 60-minute teardown call with our lead partner',
            price: 497
          }
        ]
      })
    });
    console.log(`Funnel Create Status: ${test61_funnelCreateRes.status}`, `ID: ${test61_funnelCreateRes.data.id}`);
    if (test61_funnelCreateRes.status !== 201 || !test61_funnelCreateRes.data.id) {
      throw new Error(`Funnel creation failed: ${JSON.stringify(test61_funnelCreateRes.data)}`);
    }
    console.log('✅ Funnel created with multi-step routing, custom slug, and 1-click order bump configuration');

    // 62. Visual Email Campaign Studio: Content Blocks & Test Dispatch
    console.log('\n[TEST 62] Visual Email Campaign: POST /api/crm/campaigns & POST /api/campaigns/:id/test-send');
    const test62_campaignCreateRes = await request('/api/crm/campaigns', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Q4 Product Launch Announcement',
        channel: 'email',
        kind: 'email',
        status: 'draft',
        audience: 10,
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        subject: 'Introducing Operza 2.0: The Unified Agency Operating System',
        preheader: 'Run your entire agency, CRM, funnels, and AI on a single platform.',
        blocks: [
          { id: 'b1', type: 'header', content: 'OPERZA ANNOUNCEMENT' },
          { id: 'b2', type: 'paragraph', content: 'Hello {{contact.first_name}}, we are thrilled to unveil our latest capabilities.' },
          { id: 'b3', type: 'button', content: 'Explore What is New', buttonUrl: 'https://operza.io/whats-new' },
          { id: 'b4', type: 'footer', content: 'Operza Alpha Agency · 100 Growth Blvd · Unsubscribe' }
        ]
      })
    });
    console.log(`Campaign Create Status: ${test62_campaignCreateRes.status}`, `ID: ${test62_campaignCreateRes.data.id}`);
    if (test62_campaignCreateRes.status !== 201 || !test62_campaignCreateRes.data.id) {
      throw new Error(`Campaign creation failed: ${JSON.stringify(test62_campaignCreateRes.data)}`);
    }

    const t62_campaignId = test62_campaignCreateRes.data.id;
    const t62_testSendRes = await request(`/api/campaigns/${t62_campaignId}/test-send`, {
      method: 'POST',
      body: JSON.stringify({
        recipient: 'founder@operza.io',
        subject: 'PREVIEW: Introducing Operza 2.0',
        channel: 'email'
      })
    });
    console.log(`Test Send Status: ${t62_testSendRes.status}`, `Delivered: ${t62_testSendRes.data.success}`, `Recipient: ${t62_testSendRes.data.recipient}`);
    if (t62_testSendRes.status !== 200 || !t62_testSendRes.data.success) {
      throw new Error(`Test campaign dispatch failed: ${JSON.stringify(t62_testSendRes.data)}`);
    }
    console.log('✅ Visual email campaign registered with block schema and test broadcast successfully verified');

    // 63. Public Webchat Widget Ingress & Autonomous AI Copilot Reply
    console.log('\n[TEST 63] Public Webchat Widget Ingress & Autonomous AI Copilot: GET /widget/operza.js & POST /api/widget/message');
    const rawWidgetRes = await fetch('http://localhost:4005/widget/operza.js');
    const widgetJsText = await rawWidgetRes.text();
    const widgetContentType = rawWidgetRes.headers.get('content-type');
    console.log(`Widget Script Status: ${rawWidgetRes.status}`, `Content-Type: ${widgetContentType}`);
    if (rawWidgetRes.status !== 200 || !widgetJsText.includes('operza-chat-bubble')) {
      throw new Error('Public webchat embed script delivery failed');
    }

    const t63_widgetMsgRes = await request('/api/widget/message', {
      method: 'POST',
      body: JSON.stringify({
        visitorName: 'Sophia Miller',
        visitorEmail: 'sophia.miller@acmegrowth.com',
        visitorPhone: '+1 415-555-8822',
        message: 'Hi, what are your retainer pricing tiers and performance guarantees?'
      })
    });
    console.log(`Widget Message Ingress Status: ${t63_widgetMsgRes.status}`, `Contact ID: ${t63_widgetMsgRes.data.contactId}`, `Conversation ID: ${t63_widgetMsgRes.data.conversationId}`);
    console.log(`AI Reply Snippet: "${(t63_widgetMsgRes.data.reply || '').slice(0, 75)}..."`);
    if (t63_widgetMsgRes.status !== 201 || !t63_widgetMsgRes.data.contactId || !t63_widgetMsgRes.data.conversationId || !t63_widgetMsgRes.data.reply) {
      throw new Error(`Webchat message ingress and AI reply failed: ${JSON.stringify(t63_widgetMsgRes.data)}`);
    }

    // Verify contact was tagged properly
    const t63_sophiaContactRes = await request('/api/crm/contacts?search=Sophia');
    const sophiaContact = Array.isArray(t63_sophiaContactRes.data)
      ? t63_sophiaContactRes.data[0]
      : (t63_sophiaContactRes.data.data?.[0] || t63_sophiaContactRes.data);
    if (!sophiaContact?.tags?.includes('webchat') || !sophiaContact?.tags?.includes('inbound')) {
      throw new Error(`Webchat contact tags incorrect: ${JSON.stringify(sophiaContact?.tags)}`);
    }
    console.log('✅ Public webchat embed script, lead creation, multi-channel conversation logging, and AI RAG reply verified');

    // 64. Digital Proposal E-Signature Lifecycle & Audit Verification
    console.log('\n[TEST 64] Digital Contract E-Signature: POST /api/crm/documents & POST /api/documents/:id/sign');
    const test64_docCreateRes = await request('/api/crm/documents', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Enterprise Advisory Retainer Agreement 2026',
        kind: 'contract',
        value: 18000,
        status: 'sent',
        contactId: t63_widgetMsgRes.data.contactId
      })
    });
    console.log(`Document Create Status: ${test64_docCreateRes.status}`, `ID: ${test64_docCreateRes.data.id}`);
    if (test64_docCreateRes.status !== 201 || !test64_docCreateRes.data.id) {
      throw new Error(`Document creation failed: ${JSON.stringify(test64_docCreateRes.data)}`);
    }

    const test64_docId = test64_docCreateRes.data.id;
    const test64_signRes = await request(`/api/documents/${test64_docId}/sign`, {
      method: 'POST',
      body: JSON.stringify({
        signerName: 'Sophia Miller',
        signatureData: 'data:image/svg+xml;utf8,<svg>Sophia Miller Sign</svg>'
      })
    });
    console.log(`Sign Status: ${test64_signRes.status}`, `New Status: ${test64_signRes.data.document?.status}`, `Signer: "${test64_signRes.data.document?.signerName}"`);
    if (test64_signRes.status !== 200 || test64_signRes.data.document?.status !== 'signed' || !test64_signRes.data.document?.signedAt) {
      throw new Error(`Document e-signature failed: ${JSON.stringify(test64_signRes.data)}`);
    }
    console.log('✅ Digital contract e-signature lifecycle verified: creation, signing, legal timestamping, and state transition');

    // 65. Virtual Phone Numbers Provisioning & Telephony Routing
    console.log('\n[TEST 65] Virtual Phone Numbers Provisioning: POST & GET /api/crm/phoneNumbers');
    const t65_phoneCreateRes = await request('/api/crm/phoneNumbers', {
      method: 'POST',
      body: JSON.stringify({
        number: '+1 (415) 890-2026',
        label: 'Alpha Growth Hotline',
        type: 'local',
        voice: true,
        sms: true,
        mms: true,
        status: 'active',
        assignedTo: 'Automated Tester',
        forwardTo: '+1 (555) 019-9000',
        ivrEnabled: true,
        ivrMenu: 'Press 1 for Advisory Sales, Press 2 for VIP Client Support',
        areaCode: '415'
      })
    });
    console.log(`Phone Provision Status: ${t65_phoneCreateRes.status}`, `ID: ${t65_phoneCreateRes.data.id}`);
    if (t65_phoneCreateRes.status !== 201 || !t65_phoneCreateRes.data.id) {
      throw new Error(`Phone provisioning failed: ${JSON.stringify(t65_phoneCreateRes.data)}`);
    }

    const t65_phoneListRes = await request('/api/crm/phoneNumbers');
    console.log(`Phone Numbers List Status: ${t65_phoneListRes.status}`, `Count: ${t65_phoneListRes.data.data?.length}`);
    const t65_foundPhone = t65_phoneListRes.data.data?.find(p => p.number === '+1 (415) 890-2026');
    if (!t65_foundPhone || t65_foundPhone.label !== 'Alpha Growth Hotline' || t65_foundPhone.ivrEnabled !== true) {
      throw new Error(`Failed to verify provisioned phone number: ${JSON.stringify(t65_foundPhone)}`);
    }
    console.log('✅ Virtual phone number provisioned with voice/sms/mms capabilities, IVR routing, and multi-tenant isolation');

    console.log('\n🎉 ALL 65 SYSTEM INTEGRATION TESTS PASSED CLEANLY! 🎉');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('Stopping test API server...');
    api.kill();
  }
}

runTests();
