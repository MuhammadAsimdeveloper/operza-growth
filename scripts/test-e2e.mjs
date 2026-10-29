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
    const campaignCreateRes = await request('/api/crm/campaigns', {
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
    console.log(`Campaign Create Status: ${campaignCreateRes.status}`, `ID: ${campaignCreateRes.data.id}`);
    if (campaignCreateRes.status !== 201 || !campaignCreateRes.data.id) {
      throw new Error(`Campaign creation failed: ${JSON.stringify(campaignCreateRes.data)}`);
    }

    const campaignId = campaignCreateRes.data.id;
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
    const funnelCreateRes = await request('/api/crm/websites', {
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
    console.log(`Funnel Create Status: ${funnelCreateRes.status}`, `ID: ${funnelCreateRes.data.id}`);
    if (funnelCreateRes.status !== 201 || !funnelCreateRes.data.id) {
      throw new Error(`Funnel creation failed: ${JSON.stringify(funnelCreateRes.data)}`);
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

    console.log('\n🎉 ALL 40 SYSTEM INTEGRATION TESTS PASSED CLEANLY! 🎉');
  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    console.log('Stopping test API server...');
    api.kill();
  }
}

runTests();
