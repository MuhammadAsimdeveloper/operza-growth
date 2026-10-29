import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeStep, calculateChecksum } from '../../packages/workflow-engine/src/engine.mjs';

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
const dataFile = path.resolve(root, process.env.DATA_FILE || './data/store.json');
const isProd = process.env.NODE_ENV === 'production';
const secret = String(process.env.SESSION_SECRET || 'operza-local-development-secret-key-32chars');

const collections = Object.freeze({
  contacts: { label: 'Contacts', required: ['firstName'], fields: ['firstName','lastName','email','phone','company','source','tags','status','notes','customValues'] },
  opportunities: { label: 'Opportunities', required: ['name'], fields: ['name','contactId','pipeline','stage','value','status','owner','closeDate','source','customValues'] },
  pipelines: { label: 'Pipelines', required: ['name'], fields: ['name','stages','status','description'] },
  customFields: { label: 'Custom fields', required: ['name','resource','fieldKey'], fields: ['name','resource','fieldKey','fieldType','options','required','status','description'] },
  smartLists: { label: 'Smart lists', required: ['name','filterField','operator','value'], fields: ['name','filterField','operator','value','status','description'] },
  tasks: { label: 'Tasks', required: ['title'], fields: ['title','contactId','dueDate','priority','status','assignedTo','notes'] },
  conversations: { label: 'Conversations', required: ['contactName'], fields: ['contactName','channel','subject','status','lastMessage','assignedTo','messages'] },
  appointments: { label: 'Appointments', required: ['title','startsAt'], fields: ['title','contactName','calendar','startsAt','endsAt','status','assignedTo','notes'] },
  workflows: { label: 'Workflows', required: ['name'], fields: ['name','triggerType','triggerConfig','nodes','status','description','lastRunAt','lastRunSummary'] },
  forms: { label: 'Forms', required: ['name'], fields: ['name','fields','status','submissions','description','publicSlug'] },
  formSubmissions: { label: 'Form submissions', required: ['formId'], fields: ['formId','formName','contactName','answers','status','submittedAt','source'] },
  websites: { label: 'Sites & funnels', required: ['name'], fields: ['name','type','status','domain','updatedAt','description'] },
  campaigns: { label: 'Campaigns', required: ['name'], fields: ['name','channel','status','audience','scheduledAt','description'] },
  products: { label: 'Products', required: ['name'], fields: ['name','sku','price','status','description'] },
  invoices: { label: 'Invoices', required: ['number'], fields: ['number','contactName','amount','status','dueDate','description'] },
  reviews: { label: 'Reputation', required: ['contactName'], fields: ['contactName','rating','text','source','status','receivedAt'] },
  courses: { label: 'Memberships', required: ['name'], fields: ['name','status','members','lessons','description'] },
  notes: { label: 'Notes', required: ['text'], fields: ['text','contactId','createdBy'] }
});

const emptyState = () => ({
  users: [],
  agencies: [],
  locations: [],
  memberships: [],
  invitations: [],
  sessions: [],
  records: Object.fromEntries(Object.keys(collections).map(key => [key, []])),
  workflowExecutions: [],
  audit: []
});

let state = emptyState();
let writeQueue = Promise.resolve();
const cookieSession = isProd ? '__Host-operza_session' : 'operza_session';
const cookieCsrf = 'operza_csrf';

function hash(val) { return createHash('sha256').update(String(val)).digest('hex'); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': 'http://localhost:5173',
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, x-operza-csrf, x-operza-location',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'cache-control': 'no-store',
    ...headers
  });
  res.end(JSON.stringify(body));
}

function cookieValue(header, name) {
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return '';
}

function setSessionCookies(res, sessionToken, csrfToken) {
  const secure = isProd ? '; Secure' : '';
  res.setHeader('set-cookie', [
    `${cookieSession}=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`,
    `${cookieCsrf}=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Strict; Max-Age=43200${secure}`
  ]);
}

function clearSessionCookies(res) {
  const secure = isProd ? '; Secure' : '';
  res.setHeader('set-cookie', [
    `${cookieSession}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `${cookieCsrf}=; Path=/; SameSite=Strict; Max-Age=0${secure}`
  ]);
}

async function loadState() {
  await mkdir(path.dirname(dataFile), { recursive: true });
  try {
    const raw = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    state = { ...emptyState(), ...parsed, records: { ...emptyState().records, ...(parsed.records || {}) } };
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('Error loading state:', err);
    state = emptyState();
    await saveState();
  }
}

async function saveState() {
  const snapshot = JSON.stringify(state, null, 2);
  writeQueue = writeQueue.then(async () => {
    const tempFile = `${dataFile}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tempFile, snapshot, 'utf8');
    await rename(tempFile, dataFile);
  });
  return writeQueue;
}

function getActor(req) {
  const token = cookieValue(req.headers.cookie, cookieSession);
  if (!token) return null;
  const tokenHash = hash(token);
  const session = state.sessions.find(s => s.tokenHash === tokenHash && s.expiresAt > Date.now());
  if (!session) return null;

  const user = state.users.find(u => u.id === session.userId && u.status === 'active');
  const agency = state.agencies.find(a => a.id === session.agencyId && a.status === 'active');
  const membership = state.memberships.find(m => m.agencyId === session.agencyId && m.userId === session.userId && m.status === 'active');
  const locations = state.locations.filter(l => l.agencyId === session.agencyId && l.status === 'active');
  if (!user || !agency || !membership || locations.length === 0) return null;

  const requestedLoc = req.headers['x-operza-location'];
  const activeLocation = locations.find(l => l.id === requestedLoc) || locations[0];

  return { user, agency, membership, locations, activeLocation, csrfHash: session.csrfHash };
}

async function readBody(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 5 * 1024 * 1024) throw new Error('Body too large');
  }
  return body ? JSON.parse(body) : {};
}

// Execution runner for triggers
async function triggerWorkflowExecution({ agencyId, locationId, triggerType, triggerContext }) {
  const flows = (state.records.workflows || []).filter(
    w => w.agencyId === agencyId && w.locationId === locationId && w.status === 'published' && w.triggerType === triggerType
  );

  for (const flow of flows) {
    const executionId = randomUUID();
    const execution = {
      id: executionId,
      agencyId,
      locationId,
      workflowId: flow.id,
      workflowName: flow.name,
      status: 'running',
      triggerType,
      triggerContext,
      steps: [],
      createdAt: new Date().toISOString()
    };
    state.workflowExecutions.push(execution);

    // Execute nodes sequentially
    for (const node of (flow.nodes || [])) {
      const stepRes = await executeStep({
        node,
        execution,
        triggerContext,
        crmActions: {
          sendEmail: async ({ to, subject, body }) => {
            console.log(`[OPERZA WORKFLOW EMAIL] To: ${to} | Subject: ${subject}`);
          },
          sendSms: async ({ to, message }) => {
            console.log(`[OPERZA WORKFLOW SMS] To: ${to} | Message: ${message}`);
          },
          addContactTag: async ({ contactId, tag }) => {
            const contact = state.records.contacts.find(c => c.id === contactId);
            if (contact) {
              contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
            }
          },
          createTask: async (taskData) => {
            state.records.tasks.push({
              id: randomUUID(),
              agencyId,
              locationId,
              ...taskData,
              status: 'pending',
              createdAt: new Date().toISOString()
            });
          },
          updateOpportunityStage: async ({ opportunityId, stage }) => {
            const opp = state.records.opportunities.find(o => o.id === opportunityId);
            if (opp) opp.stage = stage;
          }
        },
        aiHandler: async ({ prompt, context }) => {
          return `[Operza Copilot AI Analysis]: Lead qualified for ${context.contact?.company || 'inquiry'}.`;
        }
      });

      execution.steps.push(stepRes);
      if (stepRes.status === 'failed' || stepRes.status === 'waiting_approval' || stepRes.status === 'waiting') {
        execution.status = stepRes.status;
        break;
      }
    }

    if (execution.status === 'running') {
      execution.status = 'completed';
      execution.finishedAt = new Date().toISOString();
    }
  }
  await saveState();
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': 'http://localhost:5173',
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, x-operza-csrf, x-operza-location',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS'
    });
    res.end();
    return;
  }

  try {
    // Health Check
    if (pathname === '/health') {
      return sendJson(res, 200, {
        name: 'Operza Unified API',
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString()
      });
    }

    // Public Form Lookup
    if (method === 'GET' && pathname.startsWith('/api/forms/public/')) {
      const slug = pathname.replace('/api/forms/public/', '').trim();
      const form = (state.records.forms || []).find(f => f.publicSlug === slug && f.status === 'published');
      if (!form) return sendJson(res, 404, { error: 'Form not found or unpublished' });
      return sendJson(res, 200, { id: form.id, name: form.name, fields: form.fields, description: form.description });
    }

    // Public Form Submission Ingress -> Lead capture + Trigger Workflow
    if (method === 'POST' && pathname.startsWith('/api/forms/submit/')) {
      const slug = pathname.replace('/api/forms/submit/', '').trim();
      const form = (state.records.forms || []).find(f => f.publicSlug === slug && f.status === 'published');
      if (!form) return sendJson(res, 404, { error: 'Form not found or unpublished' });

      const body = await readBody(req);
      const answers = body.answers || {};

      // Auto-extract contact info
      const firstName = answers.firstName || answers.name || 'Website';
      const lastName = answers.lastName || 'Lead';
      const email = answers.email || '';
      const phone = answers.phone || '';
      const company = answers.company || '';

      const contactId = randomUUID();
      const contact = {
        id: contactId,
        agencyId: form.agencyId,
        locationId: form.locationId,
        firstName,
        lastName,
        email,
        phone,
        company,
        source: `Form: ${form.name}`,
        tags: ['web-lead', form.name],
        status: 'lead',
        customValues: answers,
        createdAt: new Date().toISOString()
      };
      state.records.contacts.push(contact);
      form.submissions = (form.submissions || 0) + 1;

      // Create opportunity
      const oppId = randomUUID();
      const opportunity = {
        id: oppId,
        agencyId: form.agencyId,
        locationId: form.locationId,
        contactId,
        name: `${firstName} ${lastName} - ${form.name}`,
        pipeline: 'Lead Pipeline',
        stage: 'New Inbound Lead',
        value: 1000,
        status: 'open',
        source: form.name,
        createdAt: new Date().toISOString()
      };
      state.records.opportunities.push(opportunity);

      await saveState();

      // Trigger asynchronous workflow execution
      triggerWorkflowExecution({
        agencyId: form.agencyId,
        locationId: form.locationId,
        triggerType: 'form',
        triggerContext: { form, contact, opportunity, answers }
      }).catch(err => console.error('Workflow trigger failed:', err));

      return sendJson(res, 200, { success: true, message: 'Thank you! Submission received.', contactId });
    }

    // AUTH: Signup
    if (method === 'POST' && pathname === '/api/auth/signup') {
      const body = await readBody(req);
      const { name, email, password, agencyName } = body;
      if (!name || !email || !password) return sendJson(res, 400, { error: 'Name, email, and password required' });

      const emailKey = email.toLowerCase().trim();
      if (state.users.some(u => u.email === emailKey)) {
        return sendJson(res, 409, { error: 'An account with this email already exists' });
      }

      const salt = randomBytes(16);
      const passBuf = await scrypt(password, salt, 64);
      const passwordHash = `${salt.toString('hex')}:${passBuf.toString('hex')}`;

      const userId = randomUUID();
      const agencyId = randomUUID();
      const locationId = randomUUID();

      const user = { id: userId, name: name.trim(), email: emailKey, passwordHash, status: 'active', createdAt: new Date().toISOString() };
      const agency = { id: agencyId, name: (agencyName || `${name.trim()}'s Agency`).trim(), slug: emailKey.split('@')[0], status: 'active', createdAt: new Date().toISOString() };
      const location = { id: locationId, agencyId, name: 'Main Workspace', timezone: 'UTC', status: 'active', createdAt: new Date().toISOString() };
      const membership = { id: randomUUID(), agencyId, userId, role: 'owner', status: 'active', createdAt: new Date().toISOString() };

      state.users.push(user);
      state.agencies.push(agency);
      state.locations.push(location);
      state.memberships.push(membership);

      // Create session
      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(24).toString('hex');
      state.sessions.push({
        id: randomUUID(),
        tokenHash: hash(token),
        csrfHash: hash(csrf),
        userId,
        agencyId,
        expiresAt: Date.now() + 12 * 3600 * 1000
      });

      setSessionCookies(res, token, csrf);
      await saveState();

      return sendJson(res, 201, {
        user: { id: user.id, name: user.name, email: user.email },
        agency: { id: agency.id, name: agency.name },
        locations: [location],
        activeLocationId: location.id
      });
    }

    // AUTH: Login
    if (method === 'POST' && pathname === '/api/auth/login') {
      const body = await readBody(req);
      const { email, password } = body;
      const user = state.users.find(u => u.email === String(email).toLowerCase().trim() && u.status === 'active');
      if (!user) return sendJson(res, 401, { error: 'Invalid email or password' });

      const [saltHex, keyHex] = user.passwordHash.split(':');
      const testBuf = await scrypt(password, Buffer.from(saltHex, 'hex'), 64);
      if (!safeEqual(testBuf.toString('hex'), keyHex)) {
        return sendJson(res, 401, { error: 'Invalid email or password' });
      }

      const membership = state.memberships.find(m => m.userId === user.id && m.status === 'active');
      if (!membership) return sendJson(res, 403, { error: 'No active agency found for user' });

      const agency = state.agencies.find(a => a.id === membership.agencyId && a.status === 'active');
      const locations = state.locations.filter(l => l.agencyId === agency.id && l.status === 'active');

      const token = randomBytes(32).toString('hex');
      const csrf = randomBytes(24).toString('hex');
      state.sessions.push({
        id: randomUUID(),
        tokenHash: hash(token),
        csrfHash: hash(csrf),
        userId: user.id,
        agencyId: agency.id,
        expiresAt: Date.now() + 12 * 3600 * 1000
      });

      setSessionCookies(res, token, csrf);
      await saveState();

      return sendJson(res, 200, {
        user: { id: user.id, name: user.name, email: user.email },
        agency: { id: agency.id, name: agency.name },
        locations,
        activeLocationId: locations[0]?.id
      });
    }

    // AUTH: Current Session Check
    if (method === 'GET' && pathname === '/api/auth/session') {
      const actor = getActor(req);
      if (!actor) return sendJson(res, 401, { error: 'Not authenticated' });
      return sendJson(res, 200, {
        user: { id: actor.user.id, name: actor.user.name, email: actor.user.email },
        agency: { id: actor.agency.id, name: actor.agency.name },
        locations: actor.locations,
        activeLocationId: actor.activeLocation.id,
        role: actor.membership.role
      });
    }

    // AUTH: Logout
    if (method === 'POST' && pathname === '/api/auth/logout') {
      clearSessionCookies(res);
      return sendJson(res, 200, { success: true });
    }

    // AUTH REQUIRED FOR ALL BELOW ROUTES
    const actor = getActor(req);
    if (!actor) return sendJson(res, 401, { error: 'Authentication required' });
    const { agency, activeLocation } = actor;

    // COPILOT SSE STREAMING ROUTE
    if (method === 'GET' && pathname === '/api/copilot/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': 'http://localhost:5173',
        'access-control-allow-credentials': 'true'
      });

      const message = url.searchParams.get('message') || 'Hello Operza';
      const words = `Operza Copilot received: "${message}". Real-time agent connected. You have 0 pending human approvals and your workflow pipelines are active.`.split(' ');

      let i = 0;
      const interval = setInterval(() => {
        if (i < words.length) {
          res.write(`data: ${JSON.stringify({ delta: words[i] + ' ' })}\n\n`);
          i++;
        } else {
          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          clearInterval(interval);
          res.end();
        }
      }, 70);

      req.on('close', () => clearInterval(interval));
      return;
    }

    // WORKFLOW RUNS & APPROVALS
    if (method === 'GET' && pathname === '/api/workflows/runs') {
      const runs = (state.workflowExecutions || []).filter(
        w => w.agencyId === agency.id && w.locationId === activeLocation.id
      );
      return sendJson(res, 200, runs.reverse());
    }

    if (method === 'POST' && pathname.endsWith('/approve') && pathname.startsWith('/api/workflows/runs/')) {
      const runId = pathname.split('/')[4];
      const run = (state.workflowExecutions || []).find(r => r.id === runId && r.agencyId === agency.id);
      if (!run) return sendJson(res, 404, { error: 'Workflow execution not found' });
      run.status = 'completed';
      run.approvedBy = actor.user.name;
      run.finishedAt = new Date().toISOString();
      await saveState();
      return sendJson(res, 200, { success: true, run });
    }

    // CRM COLLECTIONS CRUD (Contacts, Pipelines, Opportunities, Tasks, etc.)
    const collectionMatch = pathname.match(/^\/api\/crm\/([a-zA-Z0-9_]+)(?:\/([a-zA-Z0-9_-]+))?$/);
    if (collectionMatch) {
      const collectionName = collectionMatch[1];
      const recordId = collectionMatch[2];

      if (!collections[collectionName]) {
        return sendJson(res, 404, { error: `Collection ${collectionName} does not exist` });
      }

      const list = state.records[collectionName] || [];

      // GET /api/crm/:collection
      if (method === 'GET' && !recordId) {
        const filtered = list.filter(r => r.agencyId === agency.id && r.locationId === activeLocation.id);
        return sendJson(res, 200, filtered);
      }

      // POST /api/crm/:collection (Create)
      if (method === 'POST' && !recordId) {
        const body = await readBody(req);
        const newRecord = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          ...body,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        list.push(newRecord);
        await saveState();

        // Check if creating this record triggers a workflow
        if (collectionName === 'contacts') {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'tag',
            triggerContext: { contact: newRecord }
          }).catch(console.error);
        }

        return sendJson(res, 201, newRecord);
      }

      // PUT /api/crm/:collection/:id (Update)
      if (method === 'PUT' && recordId) {
        const body = await readBody(req);
        const index = list.findIndex(r => r.id === recordId && r.agencyId === agency.id && r.locationId === activeLocation.id);
        if (index === -1) return sendJson(res, 404, { error: 'Record not found' });

        const updated = {
          ...list[index],
          ...body,
          updatedAt: new Date().toISOString()
        };
        list[index] = updated;
        await saveState();

        // Check stage move trigger
        if (collectionName === 'opportunities' && body.stage && body.stage !== list[index].stage) {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'opportunity_stage',
            triggerContext: { opportunity: updated, stage: body.stage }
          }).catch(console.error);
        }

        return sendJson(res, 200, updated);
      }

      // DELETE /api/crm/:collection/:id
      if (method === 'DELETE' && recordId) {
        const index = list.findIndex(r => r.id === recordId && r.agencyId === agency.id && r.locationId === activeLocation.id);
        if (index === -1) return sendJson(res, 404, { error: 'Record not found' });
        list.splice(index, 1);
        await saveState();
        return sendJson(res, 200, { success: true });
      }
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { error: error.message || 'Internal Server Error' });
  }
});

await loadState();

server.listen(port, host, () => {
  console.log(`🚀 Operza Unified API Server running at http://${host}:${port}`);
});
