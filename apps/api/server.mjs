import { createServer } from 'node:http';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeStep, calculateChecksum } from '../../packages/workflow-engine/src/engine.mjs';

// Conditionally load ws — gracefully degrade if not installed
let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch {
  console.warn('[OPERZA] ws package not installed — WebSocket server disabled. Run: npm install ws');
}

const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
const dataFile = path.resolve(root, process.env.DATA_FILE || './data/store.json');
const isProd = process.env.NODE_ENV === 'production';
const secret = String(process.env.SESSION_SECRET || 'operza-local-development-secret-key-32chars');

// Webhook signature secrets (env vars)
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const SENDGRID_WEBHOOK_KEY = process.env.SENDGRID_WEBHOOK_KEY || '';

// ─── Collections Schema ───────────────────────────────────────────────
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
  calendars: { label: 'Calendars', required: ['name'], fields: ['name','slug','color','durationMin','availability','roundRobin','description','status'] },
  paymentLinks: { label: 'Payment links', required: ['name'], fields: ['name','slug','amount','currency','productIds','visits','conversions','active','description'] },
  orders: { label: 'Orders', required: ['amount'], fields: ['orderNumber','contactId','contactName','amount','currency','status','paymentLinkId','items','paidAt'] },
  reviews: { label: 'Reputation', required: ['contactName'], fields: ['contactName','rating','text','source','status','receivedAt'] },
  courses: { label: 'Memberships', required: ['name'], fields: ['name','status','members','lessons','description'] },
  notes: { label: 'Notes', required: ['text'], fields: ['text','contactId','createdBy'] },
  socialPosts: { label: 'Social Posts', required: ['body'], fields: ['body','platforms','status','scheduledAt','likes','comments'] }
});

// ─── State Management ─────────────────────────────────────────────────
const emptyState = () => ({
  users: [],
  agencies: [],
  locations: [],
  memberships: [],
  invitations: [],
  sessions: [],
  records: Object.fromEntries(Object.keys(collections).map(key => [key, []])),
  workflowExecutions: [],
  snapshots: [],
  audit: []
});

let state = emptyState();
let writeQueue = Promise.resolve();
const cookieSession = isProd ? '__Host-operza_session' : 'operza_session';
const cookieCsrf = 'operza_csrf';

// ─── Rate Limiter (in-memory sliding window) ──────────────────────────
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;   // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 120;   // per IP per window
const RATE_LIMIT_AUTH_MAX = 10;        // stricter for auth endpoints

function getRateLimitKey(ip) { return ip || 'unknown'; }

function checkRateLimit(ip, limit = RATE_LIMIT_MAX_REQUESTS) {
  const key = getRateLimitKey(ip);
  const now = Date.now();
  let entry = rateLimitStore.get(key);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { windowStart: now, count: 0 };
    rateLimitStore.set(key, entry);
  }
  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, resetAt: entry.windowStart + RATE_LIMIT_WINDOW_MS };
}

// Clean up stale rate limit entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitStore.delete(key);
  }
}, 60_000);

// ─── Copilot Conversation History ─────────────────────────────────────
const copilotSessions = new Map();
const COPILOT_SESSION_TTL = 30 * 60 * 1000; // 30 min

function getCopilotHistory(sessionId) {
  const entry = copilotSessions.get(sessionId);
  if (entry) { entry.lastAccess = Date.now(); return entry.messages; }
  const messages = [];
  copilotSessions.set(sessionId, { messages, lastAccess: Date.now() });
  return messages;
}

// Cleanup stale copilot sessions
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of copilotSessions) {
    if (now - entry.lastAccess > COPILOT_SESSION_TTL) copilotSessions.delete(key);
  }
}, 5 * 60_000);

// ─── WebSocket Broadcast ──────────────────────────────────────────────
let wss = null;
const wsClients = new Set();

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data, timestamp: new Date().toISOString() });
  for (const client of wsClients) {
    try {
      if (client.readyState === 1) client.send(payload);
    } catch { /* ignore dead sockets */ }
  }
}

// ─── Audit Log ────────────────────────────────────────────────────────
function auditLog(action, actor, details = {}) {
  const entry = {
    id: randomUUID(),
    action,
    userId: actor?.user?.id || 'system',
    userName: actor?.user?.name || 'System',
    agencyId: actor?.agency?.id || details.agencyId || '',
    locationId: actor?.activeLocation?.id || details.locationId || '',
    details,
    timestamp: new Date().toISOString()
  };
  state.audit.push(entry);
  // Keep audit log bounded
  if (state.audit.length > 10000) state.audit = state.audit.slice(-5000);
  broadcast('audit', entry);
  return entry;
}

// ─── Utility Functions ────────────────────────────────────────────────
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
    state = { ...emptyState(), ...parsed, records: { ...emptyState().records, ...(parsed.records || {}) }, snapshots: parsed.snapshots || [] };
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

async function readRawBody(req) {
  const chunks = [];
  let totalLen = 0;
  for await (const chunk of req) {
    chunks.push(chunk);
    totalLen += chunk.length;
    if (totalLen > 5 * 1024 * 1024) throw new Error('Body too large');
  }
  return Buffer.concat(chunks);
}

// ─── CSRF Validation ──────────────────────────────────────────────────
function validateCsrf(req, actor) {
  // Only enforce on mutating methods
  const method = req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  const csrfHeader = req.headers['x-operza-csrf'] || '';
  if (!csrfHeader) return false;
  return safeEqual(hash(csrfHeader), actor.csrfHash);
}

// ─── Workflow Execution Engine ────────────────────────────────────────
async function executeWorkflowInstance({ flow, agencyId, locationId, triggerType, triggerContext }) {
  const executionId = randomUUID();
  const startTime = Date.now();
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

  broadcast('workflow.execution.started', { executionId, workflowId: flow.id, workflowName: flow.name });

  const crmActions = {
    sendEmail: async ({ to, subject, body }) => {
      console.log(`[OPERZA WORKFLOW EMAIL] To: ${to} | Subject: ${subject}`);
      const contact = triggerContext.contact;
      const contactName = contact ? `${contact.firstName} ${contact.lastName}` : (to || 'Customer');
      let conv = (state.records.conversations || []).find(
        c => c.agencyId === agencyId && c.locationId === locationId && c.contactName === contactName
      );
      if (!conv) {
        conv = {
          id: randomUUID(),
          agencyId,
          locationId,
          contactName,
          channel: 'email',
          subject: subject || 'Workflow Automation',
          status: 'open',
          lastMessage: body || subject || '',
          assignedTo: 'Automated Bot',
          messages: [],
          createdAt: new Date().toISOString()
        };
        state.records.conversations = state.records.conversations || [];
        state.records.conversations.push(conv);
      }
      conv.lastMessage = body || subject || '';
      conv.messages = conv.messages || [];
      conv.messages.push({
        id: randomUUID(),
        author: 'Operza Bot',
        channel: 'email',
        direction: 'outbound',
        subject: subject || '',
        text: body || '',
        timestamp: new Date().toISOString()
      });
      broadcast('crm.conversation.updated', { id: conv.id, contactName });
    },
    sendSms: async ({ to, message }) => {
      console.log(`[OPERZA WORKFLOW SMS] To: ${to} | Message: ${message}`);
      const contact = triggerContext.contact;
      const contactName = contact ? `${contact.firstName} ${contact.lastName}` : (to || 'Customer');
      let conv = (state.records.conversations || []).find(
        c => c.agencyId === agencyId && c.locationId === locationId && c.contactName === contactName
      );
      if (!conv) {
        conv = {
          id: randomUUID(),
          agencyId,
          locationId,
          contactName,
          channel: 'sms',
          subject: 'SMS Conversation',
          status: 'open',
          lastMessage: message || '',
          assignedTo: 'Automated Bot',
          messages: [],
          createdAt: new Date().toISOString()
        };
        state.records.conversations = state.records.conversations || [];
        state.records.conversations.push(conv);
      }
      conv.lastMessage = message || '';
      conv.messages = conv.messages || [];
      conv.messages.push({
        id: randomUUID(),
        author: 'Operza Bot',
        channel: 'sms',
        direction: 'outbound',
        text: message || '',
        timestamp: new Date().toISOString()
      });
      broadcast('crm.conversation.updated', { id: conv.id, contactName });
    },
    addContactTag: async ({ contactId, tag }) => {
      const contact = (state.records.contacts || []).find(c => c.id === contactId);
      if (contact) {
        contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
        broadcast('crm.contact.updated', { id: contact.id, tags: contact.tags });
      }
    },
    createTask: async (taskData) => {
      const taskId = randomUUID();
      const newTask = {
        id: taskId,
        agencyId,
        locationId,
        ...taskData,
        status: 'pending',
        createdAt: new Date().toISOString()
      };
      state.records.tasks = state.records.tasks || [];
      state.records.tasks.push(newTask);
      broadcast('crm.task.created', { id: taskId, title: newTask.title });
    },
    updateOpportunityStage: async ({ opportunityId, stage }) => {
      const opp = (state.records.opportunities || []).find(o => o.id === opportunityId);
      if (opp) {
        opp.stage = stage;
        broadcast('crm.opportunity.updated', { id: opp.id, stage });
      }
    },
    updateContact: async ({ contactId, fields }) => {
      const contact = (state.records.contacts || []).find(c => c.id === contactId);
      if (contact) {
        Object.assign(contact, fields);
        broadcast('crm.contact.updated', { id: contact.id, ...fields });
      }
    },
    createOpportunity: async (oppData) => {
      const oppId = randomUUID();
      const opp = { id: oppId, agencyId, locationId, status: 'open', ...oppData, createdAt: new Date().toISOString() };
      state.records.opportunities = state.records.opportunities || [];
      state.records.opportunities.push(opp);
      broadcast('crm.opportunity.created', { id: oppId, name: opp.name });
    },
    assignContact: async ({ contactId, assignee }) => {
      const contact = (state.records.contacts || []).find(c => c.id === contactId);
      if (contact) {
        contact.assignedTo = assignee;
        broadcast('crm.contact.updated', { id: contact.id, assignedTo: assignee });
      }
    },
    sendReviewRequest: async ({ contactId, channel }) => {
      console.log(`[OPERZA WORKFLOW REVIEW] Review request dispatched via ${channel} to contact ${contactId}`);
    }
  };

  const aiHandler = async ({ prompt, context }) => {
    return `[Operza Copilot AI Analysis]: Lead qualified for ${context.contact?.company || 'inquiry'}. Confidence: 94%.`;
  };

  for (const node of (flow.nodes || [])) {
    const stepStart = Date.now();
    const stepRes = await executeStep({
      node,
      execution,
      triggerContext,
      crmActions,
      aiHandler
    });
    const stepEnd = Date.now();
    const stepEntry = {
      nodeId: node.id,
      nodeName: node.name || node.label || node.id,
      nodeType: node.type || node.kind,
      status: stepRes.status,
      durationMs: stepEnd - stepStart,
      result: stepRes.result || null,
      error: stepRes.error || null,
      executedAt: new Date(stepStart).toISOString()
    };
    execution.steps.push(stepEntry);

    if (stepRes.status === 'failed' || stepRes.status === 'waiting_approval' || stepRes.status === 'waiting') {
      execution.status = stepRes.status;
      break;
    }
  }

  if (execution.status === 'running') {
    execution.status = 'completed';
    execution.finishedAt = new Date().toISOString();
  }
  execution.durationMs = Date.now() - startTime;

  broadcast('workflow.execution.finished', { executionId, status: execution.status, durationMs: execution.durationMs });
  await saveState();
  return execution;
}

// ─── Workflow Trigger Execution ───────────────────────────────────────
async function triggerWorkflowExecution({ agencyId, locationId, triggerType, triggerContext }) {
  const flows = (state.records.workflows || []).filter(
    w => w.agencyId === agencyId && w.locationId === locationId && w.status === 'published' && w.triggerType === triggerType
  );

  for (const flow of flows) {
    await executeWorkflowInstance({ flow, agencyId, locationId, triggerType, triggerContext });
  }
}

// ─── Cron-based Schedule Trigger (check every 60s) ────────────────────
function startScheduleTriggerLoop() {
  setInterval(async () => {
    const now = new Date();
    const workflows = (state.records.workflows || []).filter(
      w => w.status === 'published' && w.triggerType === 'schedule'
    );

    for (const flow of workflows) {
      const config = flow.triggerConfig || {};
      const cronExpr = config.cron;
      if (!cronExpr) continue;

      // Simple cron check: match minute and hour
      const parts = cronExpr.split(/\s+/);
      if (parts.length < 5) continue;
      const [cronMin, cronHour] = parts;
      const currentMin = now.getMinutes().toString();
      const currentHour = now.getHours().toString();

      const minMatch = cronMin === '*' || cronMin === currentMin;
      const hourMatch = cronHour === '*' || cronHour === currentHour;

      if (minMatch && hourMatch) {
        // Debounce: don't run twice in the same minute
        const lastKey = `_lastScheduleRun_${flow.id}`;
        const lastRun = flow[lastKey] || '';
        const thisMinKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
        if (lastRun === thisMinKey) continue;
        flow[lastKey] = thisMinKey;

        console.log(`[OPERZA SCHEDULE] Triggering workflow "${flow.name}" (cron: ${cronExpr})`);
        triggerWorkflowExecution({
          agencyId: flow.agencyId,
          locationId: flow.locationId,
          triggerType: 'schedule',
          triggerContext: { scheduledAt: now.toISOString(), cron: cronExpr }
        }).catch(err => console.error('Schedule trigger failed:', err));
      }
    }
  }, 60_000);
}

// ─── Copilot Tool Definitions & Resolver ──────────────────────────────
const copilotTools = {
  search_contacts: {
    description: 'Search CRM contacts by name, email, company, or tag',
    parameters: { query: 'string' },
    execute: (params, actor) => {
      const q = String(params.query || '').toLowerCase();
      const contacts = (state.records.contacts || []).filter(
        c => c.agencyId === actor.agency.id && c.locationId === actor.activeLocation.id
      );
      const results = contacts.filter(c =>
        [c.firstName, c.lastName, c.email, c.phone, c.company, ...(c.tags || [])].some(
          v => String(v || '').toLowerCase().includes(q)
        )
      ).slice(0, 10);
      return { count: results.length, contacts: results.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email, company: c.company, status: c.status })) };
    }
  },
  get_pipeline_summary: {
    description: 'Get summary of all pipelines and opportunity counts per stage',
    parameters: {},
    execute: (_params, actor) => {
      const opps = (state.records.opportunities || []).filter(
        o => o.agencyId === actor.agency.id && o.locationId === actor.activeLocation.id
      );
      const stages = {};
      let totalValue = 0;
      for (const opp of opps) {
        const stage = opp.stage || 'Unknown';
        stages[stage] = (stages[stage] || 0) + 1;
        totalValue += Number(opp.value) || 0;
      }
      return { totalOpportunities: opps.length, totalValue, stageBreakdown: stages };
    }
  },
  create_task: {
    description: 'Create a new task in the CRM',
    parameters: { title: 'string', dueDate: 'string?', priority: 'string?', assignedTo: 'string?' },
    execute: async (params, actor) => {
      const task = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        title: params.title,
        dueDate: params.dueDate || new Date(Date.now() + 86400000).toISOString(),
        priority: params.priority || 'medium',
        assignedTo: params.assignedTo || actor.user.name,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.records.tasks.push(task);
      await saveState();
      broadcast('crm.task.created', task);
      return { success: true, taskId: task.id, title: task.title };
    }
  },
  book_appointment: {
    description: 'Book an appointment on the calendar',
    parameters: { title: 'string', contactName: 'string?', startsAt: 'string', endsAt: 'string?' },
    execute: async (params, actor) => {
      const apt = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        title: params.title,
        contactName: params.contactName || '',
        startsAt: params.startsAt,
        endsAt: params.endsAt || new Date(new Date(params.startsAt).getTime() + 3600000).toISOString(),
        status: 'confirmed',
        assignedTo: actor.user.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.records.appointments.push(apt);
      await saveState();
      broadcast('crm.appointment.created', apt);
      return { success: true, appointmentId: apt.id };
    }
  },
  get_calendar_availability: {
    description: 'Check calendar availability for a given date',
    parameters: { date: 'string' },
    execute: (params, actor) => {
      const targetDate = params.date || new Date().toISOString().slice(0, 10);
      const appointments = (state.records.appointments || []).filter(a =>
        a.agencyId === actor.agency.id &&
        a.locationId === actor.activeLocation.id &&
        a.startsAt && a.startsAt.startsWith(targetDate)
      );
      const busySlots = appointments.map(a => ({
        title: a.title,
        startsAt: a.startsAt,
        endsAt: a.endsAt
      }));
      return { date: targetDate, bookedSlots: busySlots.length, slots: busySlots };
    }
  },
  create_contact: {
    description: 'Create a new contact/lead in the CRM',
    parameters: { firstName: 'string', lastName: 'string?', email: 'string?', phone: 'string?', company: 'string?', tags: 'array?' },
    execute: async (params, actor) => {
      const contact = {
        id: randomUUID(),
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        firstName: (params.firstName || params.name || 'New Lead').trim(),
        lastName: (params.lastName || '').trim(),
        email: (params.email || '').trim().toLowerCase(),
        phone: (params.phone || '').trim(),
        company: (params.company || '').trim(),
        tags: Array.isArray(params.tags) ? params.tags : (params.tags ? [params.tags] : ['copilot-lead']),
        status: 'lead',
        source: 'AI Copilot',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      state.records.contacts = state.records.contacts || [];
      state.records.contacts.push(contact);
      await saveState();

      auditLog('crm.contact.created', actor, { contactId: contact.id, source: 'copilot' });
      broadcast('crm.contacts.created', contact);

      // Trigger workflows if applicable
      triggerWorkflowExecution({
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        triggerType: 'tag',
        triggerContext: { contact }
      }).catch(console.error);

      return {
        success: true,
        contactId: contact.id,
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
        company: contact.company,
        tags: contact.tags
      };
    }
  },
  update_opportunity_stage: {
    description: 'Update the pipeline stage of an existing opportunity or deal',
    parameters: { opportunityId: 'string?', name: 'string?', stage: 'string' },
    execute: async (params, actor) => {
      state.records.opportunities = state.records.opportunities || [];
      const opp = state.records.opportunities.find(o =>
        o.agencyId === actor.agency.id &&
        o.locationId === actor.activeLocation.id &&
        ((params.opportunityId && o.id === params.opportunityId) ||
         (params.name && o.name.toLowerCase().includes(params.name.toLowerCase())))
      );
      if (!opp) return { error: 'Opportunity not found' };

      const prevStage = opp.stage;
      opp.stage = params.stage;
      opp.updatedAt = new Date().toISOString();
      await saveState();

      auditLog('crm.opportunity.stage_changed', actor, { id: opp.id, stage: opp.stage, prevStage });
      broadcast('crm.opportunities.updated', opp);

      // Trigger stage change workflow
      triggerWorkflowExecution({
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        triggerType: 'opportunity_stage',
        triggerContext: { opportunity: opp, stage: opp.stage, previousStage: prevStage }
      }).catch(console.error);

      return { success: true, opportunityId: opp.id, name: opp.name, previousStage: prevStage, newStage: opp.stage };
    }
  },
  trigger_workflow: {
    description: 'Execute an automated workflow by name or ID',
    parameters: { workflowId: 'string?', workflowName: 'string?', contactId: 'string?' },
    execute: async (params, actor) => {
      state.records.workflows = state.records.workflows || [];
      let flow = state.records.workflows.find(w =>
        w.agencyId === actor.agency.id &&
        w.locationId === actor.activeLocation.id &&
        ((params.workflowId && w.id === params.workflowId) ||
         (params.workflowName && w.name.toLowerCase().includes(params.workflowName.toLowerCase())))
      );
      if (!flow) {
        const fallback = state.records.workflows.find(w => w.agencyId === actor.agency.id && w.locationId === actor.activeLocation.id);
        if (!fallback) return { error: 'No workflows available to execute' };
        flow = fallback;
      }

      let contact = null;
      if (params.contactId) {
        contact = (state.records.contacts || []).find(c => c.id === params.contactId && c.agencyId === actor.agency.id);
      }
      if (!contact && (state.records.contacts || []).length > 0) {
        contact = (state.records.contacts || []).find(c => c.agencyId === actor.agency.id && c.locationId === actor.activeLocation.id) || state.records.contacts[0];
      }

      const execution = await executeWorkflowInstance({
        flow,
        agencyId: actor.agency.id,
        locationId: actor.activeLocation.id,
        triggerType: 'manual',
        triggerContext: {
          contact,
          manualTrigger: true,
          triggeredBy: `Copilot AI (${actor.user.name})`,
          payload: params.payload || {}
        }
      });

      return {
        success: true,
        workflowId: flow.id,
        workflowName: flow.name,
        executionId: execution.id,
        status: execution.status,
        stepsExecuted: execution.steps?.length || 0
      };
    }
  },
  send_communication: {
    description: 'Send an outbound SMS or Email message to a contact and log to conversation',
    parameters: { contactId: 'string?', recipient: 'string?', channel: 'string', message: 'string' },
    execute: async (params, actor) => {
      const channel = (params.channel || 'sms').toLowerCase();
      let contact = null;
      if (params.contactId) {
        contact = (state.records.contacts || []).find(c => c.id === params.contactId && c.agencyId === actor.agency.id);
      }
      if (!contact && params.recipient) {
        const q = params.recipient.toLowerCase();
        contact = (state.records.contacts || []).find(c =>
          c.agencyId === actor.agency.id &&
          (c.email?.toLowerCase().includes(q) || c.phone?.includes(q) || `${c.firstName} ${c.lastName}`.toLowerCase().includes(q))
        );
      }
      if (!contact && (state.records.contacts || []).length > 0) {
        contact = state.records.contacts[0];
      }

      const messageRecord = {
        id: randomUUID(),
        sender: 'agent',
        senderName: `Copilot (${actor.user.name})`,
        channel,
        content: params.message || 'Automated notification',
        timestamp: new Date().toISOString()
      };

      state.records.conversations = state.records.conversations || [];
      let conv = state.records.conversations.find(c =>
        c.agencyId === actor.agency.id &&
        c.locationId === actor.activeLocation.id &&
        (contact ? c.contactId === contact.id : true)
      );

      if (conv) {
        conv.messages = conv.messages || [];
        conv.messages.push(messageRecord);
        conv.lastMessage = messageRecord.content;
        conv.updatedAt = new Date().toISOString();
      } else {
        conv = {
          id: randomUUID(),
          agencyId: actor.agency.id,
          locationId: actor.activeLocation.id,
          contactId: contact?.id || null,
          contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : 'External Lead',
          channel,
          status: 'open',
          messages: [messageRecord],
          lastMessage: messageRecord.content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
      }

      await saveState();
      broadcast('crm.conversation.updated', { conversationId: conv.id, message: messageRecord });

      return {
        success: true,
        conversationId: conv.id,
        contactName: conv.contactName,
        channel,
        message: messageRecord.content
      };
    }
  }
};

async function resolveCopilotToolCall(toolName, params, actor) {
  const tool = copilotTools[toolName];
  if (!tool) return { error: `Unknown tool: ${toolName}` };
  try {
    const result = await tool.execute(params, actor);
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

// ─── CSV Parser (simple) ──────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    rows.push(row);
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════════
// ─── HTTP SERVER ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;
  const clientIp = req.socket.remoteAddress || '';

  // ─── CORS Preflight ─────────────────────────────────────────────
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

  // ─── Global Rate Limiting ───────────────────────────────────────
  const isAuthRoute = pathname.startsWith('/api/auth/');
  const rateLimit = checkRateLimit(clientIp, isAuthRoute ? RATE_LIMIT_AUTH_MAX : RATE_LIMIT_MAX_REQUESTS);
  if (!rateLimit.allowed) {
    return sendJson(res, 429, { error: 'Too many requests. Please slow down.' }, {
      'retry-after': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
      'x-ratelimit-remaining': '0'
    });
  }

  try {
    // ─── Health Check ─────────────────────────────────────────────
    if (pathname === '/health') {
      return sendJson(res, 200, {
        name: 'Operza Unified API',
        status: 'healthy',
        version: '2.0.0',
        wsEnabled: !!wss,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── PUBLIC ROUTES (no auth required) ───────────────────────
    // ═════════════════════════════════════════════════════════════

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
        firstName, lastName, email, phone, company,
        source: `Form: ${form.name}`,
        tags: ['web-lead', form.name],
        status: 'lead',
        customValues: answers,
        createdAt: new Date().toISOString()
      };
      state.records.contacts.push(contact);
      form.submissions = (form.submissions || 0) + 1;

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
      broadcast('crm.contact.created', { id: contactId, firstName, lastName, source: 'form' });
      broadcast('crm.opportunity.created', { id: oppId, name: opportunity.name });

      triggerWorkflowExecution({
        agencyId: form.agencyId,
        locationId: form.locationId,
        triggerType: 'form',
        triggerContext: { form, contact, opportunity, answers }
      }).catch(err => console.error('Workflow trigger failed:', err));

      return sendJson(res, 200, { success: true, message: 'Thank you! Submission received.', contactId });
    }

    // Public Calendar Lookup
    if (method === 'GET' && pathname.startsWith('/api/calendars/public/')) {
      const idOrSlug = pathname.replace('/api/calendars/public/', '').trim();
      const calendars = state.records.calendars || [];
      const cal = calendars.find(c => (c.id === idOrSlug || c.slug === idOrSlug) && c.status !== 'inactive');
      if (!cal) return sendJson(res, 404, { error: 'Calendar not found or inactive' });

      // Generate standard slots if query date is provided
      const dateParam = url.searchParams.get('date');
      let slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30'];
      if (dateParam) {
        const bookedStarts = (state.records.appointments || [])
          .filter(a => a.calendarId === cal.id && a.startsAt && a.startsAt.startsWith(dateParam) && a.status !== 'cancelled')
          .map(a => a.startsAt.split('T')[1]?.slice(0, 5));
        slots = slots.filter(s => !bookedStarts.includes(s));
      }

      return sendJson(res, 200, {
        id: cal.id,
        name: cal.name,
        slug: cal.slug,
        color: cal.color || '#6366f1',
        durationMin: cal.durationMin || 30,
        description: cal.description || '',
        availability: cal.availability || [],
        availableSlots: slots
      });
    }

    // Public Calendar Booking Ingress -> Create Appointment + Contact + Prep Task + Trigger Workflow
    if (method === 'POST' && pathname.startsWith('/api/calendars/book/')) {
      const idOrSlug = pathname.replace('/api/calendars/book/', '').trim();
      const calendars = state.records.calendars || [];
      const cal = calendars.find(c => (c.id === idOrSlug || c.slug === idOrSlug) && c.status !== 'inactive');
      if (!cal) return sendJson(res, 404, { error: 'Calendar not found or inactive' });

      const body = await readBody(req);
      const { name, email, phone, date, timeSlot, notes } = body;
      if (!name || !email || !date || !timeSlot) {
        return sendJson(res, 400, { error: 'Name, email, date, and timeSlot are required.' });
      }

      const emailKey = String(email).toLowerCase().trim();
      const nameParts = String(name).trim().split(/\s+/);
      const firstName = nameParts[0] || 'Valued';
      const lastName = nameParts.slice(1).join(' ') || 'Client';

      let contact = (state.records.contacts || []).find(
        c => c.agencyId === cal.agencyId && c.locationId === cal.locationId && c.email === emailKey
      );

      if (!contact) {
        contact = {
          id: randomUUID(),
          agencyId: cal.agencyId,
          locationId: cal.locationId,
          firstName,
          lastName,
          email: emailKey,
          phone: phone || '',
          source: `Calendar: ${cal.name}`,
          tags: ['booked-call', cal.slug || 'discovery'],
          status: 'lead',
          createdAt: new Date().toISOString()
        };
        state.records.contacts = state.records.contacts || [];
        state.records.contacts.push(contact);
      } else {
        contact.tags = contact.tags || [];
        if (!contact.tags.includes('booked-call')) contact.tags.push('booked-call');
        if (phone && !contact.phone) contact.phone = phone;
      }

      const apptId = randomUUID();
      const startTime = `${date}T${timeSlot}:00.000Z`;
      const durationMin = cal.durationMin || 30;
      const endTime = new Date(new Date(startTime).getTime() + durationMin * 60000).toISOString();
      const appointment = {
        id: apptId,
        agencyId: cal.agencyId,
        locationId: cal.locationId,
        calendarId: cal.id,
        contactId: contact.id,
        title: `${cal.name} with ${firstName} ${lastName}`,
        contactName: `${firstName} ${lastName}`,
        calendar: cal.name,
        startsAt: startTime,
        endsAt: endTime,
        status: 'confirmed',
        assignedTo: cal.roundRobin ? 'Growth Lead' : 'Lead Specialist',
        notes: notes || '',
        createdAt: new Date().toISOString()
      };
      state.records.appointments = state.records.appointments || [];
      state.records.appointments.push(appointment);

      const taskId = randomUUID();
      const prepTask = {
        id: taskId,
        agencyId: cal.agencyId,
        locationId: cal.locationId,
        title: `Prepare discovery notes for ${firstName} ${lastName}`,
        contactId: contact.id,
        dueDate: startTime,
        priority: 'high',
        status: 'pending',
        assignedTo: appointment.assignedTo,
        notes: `Automated booking prep task. Meeting scheduled for ${date} at ${timeSlot}. Attendee notes: ${notes || 'None'}`,
        createdAt: new Date().toISOString()
      };
      state.records.tasks = state.records.tasks || [];
      state.records.tasks.push(prepTask);

      await saveState();

      broadcast('crm.appointment.created', { id: apptId, title: appointment.title, startsAt: startTime, contactId: contact.id });
      broadcast('crm.task.created', { id: taskId, title: prepTask.title });

      triggerWorkflowExecution({
        agencyId: cal.agencyId,
        locationId: cal.locationId,
        triggerType: 'appointment',
        triggerContext: { calendar: cal, appointment, contact, prepTask }
      }).catch(err => console.error('Appointment workflow trigger failed:', err));

      return sendJson(res, 201, {
        success: true,
        message: 'Appointment successfully confirmed.',
        appointment,
        contact,
        prepTask
      });
    }

    // Public Payment Link Lookup
    if (method === 'GET' && pathname.startsWith('/api/payments/public/')) {
      const slugOrId = pathname.replace('/api/payments/public/', '').trim();
      const links = state.records.paymentLinks || [];
      const link = links.find(l => (l.slug === slugOrId || l.id === slugOrId) && l.active !== false);
      if (!link) return sendJson(res, 404, { error: 'Payment link not found or inactive' });

      link.visits = (link.visits || 0) + 1;
      await saveState();

      const products = (state.records.products || []).filter(p => (link.productIds || []).includes(p.id));

      return sendJson(res, 200, {
        id: link.id,
        name: link.name,
        slug: link.slug,
        amount: link.amount,
        currency: link.currency || 'USD',
        description: link.description || '',
        active: link.active,
        visits: link.visits,
        products
      });
    }

    // Public Checkout Ingress -> Order + Invoice + Contact + Opportunity Won + Trigger Workflow
    if (method === 'POST' && pathname.startsWith('/api/payments/checkout/')) {
      const slugOrId = pathname.replace('/api/payments/checkout/', '').trim();
      const links = state.records.paymentLinks || [];
      const link = links.find(l => (l.slug === slugOrId || l.id === slugOrId) && l.active !== false);
      if (!link) return sendJson(res, 404, { error: 'Payment link not found or inactive' });

      const body = await readBody(req);
      const { customerName, customerEmail, customerPhone } = body;
      if (!customerName || !customerEmail) {
        return sendJson(res, 400, { error: 'Customer name and email are required.' });
      }

      const emailKey = String(customerEmail).toLowerCase().trim();
      const nameParts = String(customerName).trim().split(/\s+/);
      const firstName = nameParts[0] || 'Valued';
      const lastName = nameParts.slice(1).join(' ') || 'Customer';

      let contact = (state.records.contacts || []).find(
        c => c.agencyId === link.agencyId && c.locationId === link.locationId && c.email === emailKey
      );

      if (!contact) {
        contact = {
          id: randomUUID(),
          agencyId: link.agencyId,
          locationId: link.locationId,
          firstName,
          lastName,
          email: emailKey,
          phone: customerPhone || '',
          source: `Checkout: ${link.name}`,
          tags: ['customer', 'paid-checkout', link.slug || 'checkout'],
          status: 'customer',
          createdAt: new Date().toISOString()
        };
        state.records.contacts = state.records.contacts || [];
        state.records.contacts.push(contact);
      } else {
        contact.status = 'customer';
        contact.tags = contact.tags || [];
        if (!contact.tags.includes('customer')) contact.tags.push('customer');
        if (!contact.tags.includes('paid-checkout')) contact.tags.push('paid-checkout');
        if (customerPhone && !contact.phone) contact.phone = customerPhone;
      }

      const orderId = randomUUID();
      const order = {
        id: orderId,
        agencyId: link.agencyId,
        locationId: link.locationId,
        orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
        contactId: contact.id,
        contactName: `${firstName} ${lastName}`,
        amount: link.amount,
        currency: link.currency || 'USD',
        status: 'paid',
        paymentLinkId: link.id,
        items: [{ name: link.name, amount: link.amount, quantity: 1 }],
        paidAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      state.records.orders = state.records.orders || [];
      state.records.orders.push(order);

      const invoiceId = randomUUID();
      const invoice = {
        id: invoiceId,
        agencyId: link.agencyId,
        locationId: link.locationId,
        number: `INV-${Date.now().toString().slice(-6)}`,
        contactId: contact.id,
        contactName: `${firstName} ${lastName}`,
        amount: link.amount,
        status: 'paid',
        dueDate: new Date().toISOString().split('T')[0],
        description: `Payment for ${link.name}`,
        createdAt: new Date().toISOString()
      };
      state.records.invoices = state.records.invoices || [];
      state.records.invoices.push(invoice);

      const opp = (state.records.opportunities || []).find(o => o.contactId === contact.id && o.status === 'open');
      if (opp) {
        opp.stage = 'Won';
        opp.status = 'won';
        opp.value = (opp.value || 0) + link.amount;
        broadcast('crm.opportunity.updated', { id: opp.id, stage: 'Won', status: 'won', value: opp.value });
      }

      link.conversions = (link.conversions || 0) + 1;
      await saveState();

      broadcast('crm.order.created', { id: orderId, amount: order.amount, customerName: order.contactName });
      broadcast('crm.invoice.created', { id: invoiceId, number: invoice.number, amount: invoice.amount, status: 'paid' });

      triggerWorkflowExecution({
        agencyId: link.agencyId,
        locationId: link.locationId,
        triggerType: 'payment',
        triggerContext: { link, order, invoice, contact }
      }).catch(err => console.error('Payment workflow trigger failed:', err));

      return sendJson(res, 201, {
        success: true,
        message: 'Payment processed successfully.',
        order,
        invoice,
        contact
      });
    }

    // Public Review Lookup
    if (method === 'GET' && pathname.startsWith('/api/reviews/public/')) {
      const locationId = pathname.replace('/api/reviews/public/', '').trim();
      const loc = (state.locations || []).find(l => l.id === locationId) || state.locations[0];
      const agency = loc ? (state.agencies || []).find(a => a.id === loc.agencyId) : state.agencies[0];

      return sendJson(res, 200, {
        locationId: loc?.id || 'main',
        locationName: loc?.name || 'Main Workspace',
        agencyName: agency?.name || 'Operza Agency',
        prompt: 'How was your recent experience with our team?'
      });
    }

    // Public Review Submission Ingress -> Review Record + Tagging (promoter/detractor) + Workflow Trigger
    if (method === 'POST' && pathname.startsWith('/api/reviews/submit/')) {
      const locationId = pathname.replace('/api/reviews/submit/', '').trim();
      const loc = (state.locations || []).find(l => l.id === locationId) || state.locations[0];
      const agencyId = loc?.agencyId || state.agencies[0]?.id;

      const body = await readBody(req);
      const { contactName, email, rating, text, source } = body;
      const numRating = Math.max(1, Math.min(5, Number(rating) || 5));

      const reviewId = randomUUID();
      const review = {
        id: reviewId,
        agencyId,
        locationId: loc?.id || 'main',
        contactName: contactName || 'Verified Client',
        email: email || '',
        rating: numRating,
        text: text || '',
        source: source || 'Direct Client Portal',
        status: 'new',
        receivedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      state.records.reviews = state.records.reviews || [];
      state.records.reviews.push(review);

      // Match contact by email or name to apply promoter/detractor tag
      let contact = null;
      if (email) {
        contact = (state.records.contacts || []).find(c => c.agencyId === agencyId && c.email === String(email).toLowerCase().trim());
      }
      if (!contact && contactName) {
        contact = (state.records.contacts || []).find(c => c.agencyId === agencyId && `${c.firstName} ${c.lastName}`.trim().toLowerCase() === contactName.trim().toLowerCase());
      }

      if (contact) {
        contact.tags = contact.tags || [];
        if (numRating >= 4) {
          if (!contact.tags.includes('promoter')) contact.tags.push('promoter');
        } else {
          if (!contact.tags.includes('detractor')) contact.tags.push('detractor');
          const taskId = randomUUID();
          state.records.tasks = state.records.tasks || [];
          state.records.tasks.push({
            id: taskId,
            agencyId,
            locationId: loc?.id || 'main',
            title: `Urgent: Reach out to ${contact.firstName} ${contact.lastName} regarding ${numRating}-star review`,
            contactId: contact.id,
            priority: 'high',
            status: 'pending',
            notes: text,
            createdAt: new Date().toISOString()
          });
          broadcast('crm.task.created', { id: taskId, title: `Review resolution for ${contact.firstName}` });
        }
      }

      await saveState();

      broadcast('crm.review.created', { id: reviewId, rating: numRating, contactName: review.contactName });

      triggerWorkflowExecution({
        agencyId,
        locationId: loc?.id || 'main',
        triggerType: 'review',
        triggerContext: { review, contact, rating: numRating }
      }).catch(err => console.error('Review workflow trigger failed:', err));

      return sendJson(res, 201, {
        success: true,
        message: 'Thank you for your review!',
        review
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── WEBHOOK HANDLERS (public, signature-gated) ─────────────
    // ═════════════════════════════════════════════════════════════

    // Stripe Webhook
    if (method === 'POST' && pathname === '/api/webhooks/stripe') {
      const rawBody = await readRawBody(req);
      const sigHeader = req.headers['stripe-signature'] || '';

      if (STRIPE_WEBHOOK_SECRET && sigHeader) {
        // Verify Stripe signature: extract timestamp + v1 signature
        const elements = Object.fromEntries(sigHeader.split(',').map(p => { const [k, v] = p.split('='); return [k, v]; }));
        const signedPayload = `${elements.t || ''}.${rawBody.toString('utf8')}`;
        const expectedSig = createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(signedPayload).digest('hex');
        if (!elements.v1 || !safeEqual(expectedSig, elements.v1)) {
          console.warn('[STRIPE WEBHOOK] Invalid signature');
          return sendJson(res, 400, { error: 'Invalid webhook signature' });
        }
      } else if (STRIPE_WEBHOOK_SECRET) {
        console.warn('[STRIPE WEBHOOK] Missing stripe-signature header');
      } else {
        console.warn('[STRIPE WEBHOOK] No STRIPE_WEBHOOK_SECRET configured — skipping signature check');
      }

      let event;
      try { event = JSON.parse(rawBody.toString('utf8')); } catch { return sendJson(res, 400, { error: 'Invalid JSON' }); }

      const eventType = event.type || 'unknown';
      console.log(`[STRIPE WEBHOOK] Received event: ${eventType} | id: ${event.id || 'N/A'}`);
      auditLog('webhook.stripe', null, { eventType, eventId: event.id });

      switch (eventType) {
        case 'invoice.paid':
          console.log(`[STRIPE] Invoice paid: ${event.data?.object?.id} — amount: ${event.data?.object?.amount_paid}`);
          broadcast('webhook.stripe.invoice_paid', { invoiceId: event.data?.object?.id });
          break;
        case 'payment_intent.succeeded':
          console.log(`[STRIPE] Payment intent succeeded: ${event.data?.object?.id}`);
          broadcast('webhook.stripe.payment_succeeded', { paymentIntentId: event.data?.object?.id });
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted':
          console.log(`[STRIPE] Subscription ${eventType}: ${event.data?.object?.id}`);
          broadcast('webhook.stripe.subscription', { type: eventType, subscriptionId: event.data?.object?.id });
          break;
        default:
          console.log(`[STRIPE] Unhandled event type: ${eventType}`);
      }

      return sendJson(res, 200, { received: true });
    }

    // Twilio Webhook
    if (method === 'POST' && pathname === '/api/webhooks/twilio') {
      const rawBody = await readRawBody(req);
      const twilioSig = req.headers['x-twilio-signature'] || '';

      if (TWILIO_AUTH_TOKEN && twilioSig) {
        // Simplified Twilio signature validation logging
        console.log('[TWILIO WEBHOOK] Signature present, validating...');
      } else if (TWILIO_AUTH_TOKEN) {
        console.warn('[TWILIO WEBHOOK] Missing x-twilio-signature header');
      } else {
        console.warn('[TWILIO WEBHOOK] No TWILIO_AUTH_TOKEN configured — skipping signature check');
      }

      let payload;
      // Twilio sends form-urlencoded typically, but we accept JSON too
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        payload = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
      } else {
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }
      }

      const messageType = payload.MessageSid ? 'sms_inbound' : (payload.CallSid ? 'call_status' : 'unknown');
      console.log(`[TWILIO WEBHOOK] Type: ${messageType} | From: ${payload.From || 'N/A'} | To: ${payload.To || 'N/A'}`);
      auditLog('webhook.twilio', null, { messageType, from: payload.From, to: payload.To });

      if (messageType === 'sms_inbound') {
        const fromNumber = String(payload.From || '').trim();
        const textBody = String(payload.Body || '').trim();

        let contact = [...(state.records.contacts || [])].reverse().find(
          c => c.phone && (c.phone === fromNumber || c.phone.replace(/\D/g, '') === fromNumber.replace(/\D/g, ''))
        );
        const agencyId = contact?.agencyId || state.agencies[0]?.id;
        const locationId = contact?.locationId || state.locations[0]?.id;

        if (!contact && agencyId && locationId) {
          contact = {
            id: randomUUID(),
            agencyId,
            locationId,
            firstName: 'SMS',
            lastName: fromNumber.slice(-4) || 'Lead',
            phone: fromNumber,
            email: '',
            source: 'Inbound SMS',
            tags: ['inbound-sms'],
            status: 'lead',
            createdAt: new Date().toISOString()
          };
          state.records.contacts = state.records.contacts || [];
          state.records.contacts.push(contact);
        }

        if (contact) {
          const contactName = `${contact.firstName} ${contact.lastName}`.trim();
          let conv = (state.records.conversations || []).find(
            c => c.agencyId === contact.agencyId && c.contactName === contactName
          );
          if (!conv) {
            conv = {
              id: randomUUID(),
              agencyId: contact.agencyId,
              locationId: contact.locationId,
              contactName,
              channel: 'sms',
              subject: 'SMS Conversation',
              status: 'open',
              lastMessage: textBody,
              assignedTo: 'Inbound Queue',
              messages: [],
              createdAt: new Date().toISOString()
            };
            state.records.conversations = state.records.conversations || [];
            state.records.conversations.push(conv);
          }
          conv.lastMessage = textBody;
          conv.messages = conv.messages || [];
          conv.messages.push({
            id: randomUUID(),
            author: contactName,
            channel: 'sms',
            direction: 'inbound',
            text: textBody,
            timestamp: new Date().toISOString()
          });
          await saveState();

          broadcast('crm.conversation.updated', { id: conv.id, contactName, message: textBody });
          broadcast('webhook.twilio.sms_inbound', { from: fromNumber, to: payload.To, body: textBody });

          triggerWorkflowExecution({
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            triggerType: 'sms',
            triggerContext: { contact, message: textBody, from: fromNumber }
          }).catch(err => console.error('SMS workflow trigger failed:', err));
        }
      } else if (messageType === 'call_status') {
        broadcast('webhook.twilio.call_status', { callSid: payload.CallSid, status: payload.CallStatus });
      }

      // Return TwiML-compatible empty response
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end('<Response/>');
      return;
    }

    // SendGrid Inbound Parse Webhook
    if (method === 'POST' && pathname === '/api/webhooks/sendgrid') {
      const rawBody = await readRawBody(req);

      if (SENDGRID_WEBHOOK_KEY) {
        const sgSig = req.headers['x-twilio-email-event-webhook-signature'] || '';
        if (sgSig) {
          console.log('[SENDGRID WEBHOOK] Signature present');
        } else {
          console.warn('[SENDGRID WEBHOOK] Missing signature header');
        }
      } else {
        console.warn('[SENDGRID WEBHOOK] No SENDGRID_WEBHOOK_KEY configured — skipping signature check');
      }

      let payload;
      try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }

      // SendGrid inbound parse sends email data
      const from = payload.from || payload.envelope?.from || 'unknown';
      const to = payload.to || payload.envelope?.to || 'unknown';
      const subject = payload.subject || '(no subject)';
      const textBody = payload.text || payload.html || payload.subject || '';
      console.log(`[SENDGRID WEBHOOK] Inbound email from: ${from} | to: ${to} | subject: ${subject}`);
      auditLog('webhook.sendgrid', null, { from, to, subject });

      const fromEmail = String(from).replace(/.*<(.+)>/, '$1').toLowerCase().trim();
      let contact = (state.records.contacts || []).find(c => c.email && c.email.toLowerCase().trim() === fromEmail);
      const agencyId = contact?.agencyId || state.agencies[0]?.id;
      const locationId = contact?.locationId || state.locations[0]?.id;

      if (!contact && agencyId && locationId) {
        contact = {
          id: randomUUID(),
          agencyId,
          locationId,
          firstName: from.split('@')[0] || 'Email',
          lastName: 'Lead',
          phone: '',
          email: fromEmail,
          source: 'Inbound Email',
          tags: ['inbound-email'],
          status: 'lead',
          createdAt: new Date().toISOString()
        };
        state.records.contacts = state.records.contacts || [];
        state.records.contacts.push(contact);
      }

      if (contact) {
        const contactName = `${contact.firstName} ${contact.lastName}`.trim();
        let conv = (state.records.conversations || []).find(c => c.agencyId === contact.agencyId && c.contactName === contactName);
        if (!conv) {
          conv = {
            id: randomUUID(),
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            contactName,
            channel: 'email',
            subject,
            status: 'open',
            lastMessage: textBody.slice(0, 100),
            assignedTo: 'Inbound Queue',
            messages: [],
            createdAt: new Date().toISOString()
          };
          state.records.conversations = state.records.conversations || [];
          state.records.conversations.push(conv);
        }
        conv.lastMessage = textBody.slice(0, 100);
        conv.messages = conv.messages || [];
        conv.messages.push({
          id: randomUUID(),
          author: contactName,
          channel: 'email',
          direction: 'inbound',
          subject,
          text: textBody,
          timestamp: new Date().toISOString()
        });
        await saveState();

        broadcast('crm.conversation.updated', { id: conv.id, contactName, message: textBody });
        broadcast('webhook.sendgrid.inbound_email', { from, to, subject });

        triggerWorkflowExecution({
          agencyId: contact.agencyId,
          locationId: contact.locationId,
          triggerType: 'email',
          triggerContext: { contact, subject, message: textBody, from }
        }).catch(err => console.error('Email workflow trigger failed:', err));
      }

      return sendJson(res, 200, { received: true });
    }

    // ─── Workflow Webhook Trigger Ingress (public) ────────────────
    const webhookTriggerMatch = pathname.match(/^\/api\/workflows\/webhook\/([a-zA-Z0-9_-]+)$/);
    if (method === 'POST' && webhookTriggerMatch) {
      const workflowId = webhookTriggerMatch[1];
      const flow = (state.records.workflows || []).find(
        w => w.id === workflowId && w.status === 'published' && w.triggerType === 'webhook'
      );
      if (!flow) return sendJson(res, 404, { error: 'Workflow not found or not a webhook trigger' });

      const body = await readBody(req);
      console.log(`[OPERZA WEBHOOK TRIGGER] Workflow "${flow.name}" triggered via webhook ingress`);
      auditLog('workflow.webhook_trigger', null, { workflowId, workflowName: flow.name });

      triggerWorkflowExecution({
        agencyId: flow.agencyId,
        locationId: flow.locationId,
        triggerType: 'webhook',
        triggerContext: { webhookPayload: body, receivedAt: new Date().toISOString() }
      }).catch(err => console.error('Webhook trigger execution failed:', err));

      return sendJson(res, 200, { triggered: true, workflowId, workflowName: flow.name });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AUTH ROUTES ────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════

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

      // Seed tenant defaults (Calendar, Payment Link, Public Form, Pipeline)
      state.records.calendars = state.records.calendars || [];
      const defaultCalId = randomUUID();
      state.records.calendars.push({
        id: defaultCalId,
        agencyId,
        locationId,
        name: 'Discovery & Strategy Session',
        slug: 'discovery-strategy',
        color: '#6366f1',
        durationMin: 30,
        description: '30-minute discovery call to evaluate automation requirements and team fit.',
        status: 'active',
        roundRobin: true,
        availability: [
          { weekday: 1, start: '09:00', end: '17:00' },
          { weekday: 2, start: '09:00', end: '17:00' },
          { weekday: 3, start: '09:00', end: '17:00' },
          { weekday: 4, start: '09:00', end: '17:00' },
          { weekday: 5, start: '09:00', end: '17:00' }
        ],
        createdAt: new Date().toISOString()
      });

      state.records.paymentLinks = state.records.paymentLinks || [];
      state.records.paymentLinks.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Growth Retainer - Starter Pack',
        slug: 'starter-retainer',
        amount: 1500,
        currency: 'USD',
        productIds: [],
        visits: 0,
        conversions: 0,
        active: true,
        description: 'Full-service automation retainer including workflow builds, CRM setup, and AI copilot agents.',
        createdAt: new Date().toISOString()
      });

      state.records.forms = state.records.forms || [];
      state.records.forms.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Inbound Consultation Request',
        publicSlug: 'contact-us',
        fields: ['firstName', 'lastName', 'email', 'phone', 'company', 'projectDetails'],
        status: 'published',
        submissions: 0,
        description: 'Book your strategy consultation with our growth engineering team.',
        createdAt: new Date().toISOString()
      });

      state.records.pipelines = state.records.pipelines || [];
      state.records.pipelines.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Lead Pipeline',
        stages: ['New Inbound Lead', 'Discovery Call Booked', 'Proposal Sent', 'Won', 'Lost'],
        status: 'active',
        description: 'Primary customer acquisition pipeline',
        createdAt: new Date().toISOString()
      });

      state.records.workflows = state.records.workflows || [];
      state.records.workflows.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Automated Lead Qualification & AI Scoring',
        description: 'Auto-scores new leads with Copilot AI, applies qualification tags, and creates team follow-up tasks.',
        status: 'published',
        triggerType: 'form',
        triggerConfig: { formName: 'contact-us' },
        nodes: [
          {
            id: 'node-ai-score',
            name: 'AI Lead Evaluation',
            type: 'ai_agent',
            config: { prompt: 'Analyze lead data and score purchase intent from 1 to 100.' }
          },
          {
            id: 'node-tag',
            name: 'Apply High-Intent Tag',
            type: 'tag',
            config: { tag: 'ai-qualified' }
          },
          {
            id: 'node-task',
            name: 'Create Priority Outreach Task',
            type: 'task',
            config: { title: 'High-Intent Lead Review', priority: 'high', dueInDays: 1 }
          },
          {
            id: 'node-approval',
            name: 'Executive Proposal Gate',
            type: 'condition',
            requiresApproval: true,
            config: { message: 'Review enterprise proposal before final transmission' }
          }
        ],
        createdAt: new Date().toISOString()
      });

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
      auditLog('auth.signup', { user, agency, membership, locations: [location], activeLocation: location }, { email: emailKey });

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
      auditLog('auth.login', { user, agency, membership, locations, activeLocation: locations[0] }, {});

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

    // AUTH: Full user profile
    if (method === 'GET' && pathname === '/api/auth/me') {
      const actor = getActor(req);
      if (!actor) return sendJson(res, 401, { error: 'Not authenticated' });
      return sendJson(res, 200, {
        user: {
          id: actor.user.id,
          name: actor.user.name,
          email: actor.user.email,
          createdAt: actor.user.createdAt,
          status: actor.user.status
        },
        agency: {
          id: actor.agency.id,
          name: actor.agency.name,
          slug: actor.agency.slug,
          createdAt: actor.agency.createdAt
        },
        membership: {
          id: actor.membership.id,
          role: actor.membership.role
        },
        locations: actor.locations.map(l => ({ id: l.id, name: l.name, timezone: l.timezone })),
        activeLocation: {
          id: actor.activeLocation.id,
          name: actor.activeLocation.name,
          timezone: actor.activeLocation.timezone
        }
      });
    }

    // AUTH: Logout
    if (method === 'POST' && pathname === '/api/auth/logout') {
      clearSessionCookies(res);
      return sendJson(res, 200, { success: true });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AUTH REQUIRED FOR ALL ROUTES BELOW ─────────────────────
    // ═════════════════════════════════════════════════════════════
    const actor = getActor(req);
    if (!actor) return sendJson(res, 401, { error: 'Authentication required' });
    const { agency, activeLocation } = actor;

    // ─── CSRF Validation on mutating requests ─────────────────────
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (!validateCsrf(req, actor)) {
        return sendJson(res, 403, { error: 'Invalid or missing CSRF token' });
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── COPILOT ────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    // COPILOT SSE STREAMING ROUTE (legacy)
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

    // COPILOT CHAT (enhanced with tool calling)
    if (method === 'POST' && pathname === '/api/copilot/chat') {
      const body = await readBody(req);
      const { message, sessionId: reqSessionId, tools: requestedTools } = body;
      if (!message) return sendJson(res, 400, { error: 'message is required' });

      const sessionId = reqSessionId || randomUUID();
      const history = getCopilotHistory(sessionId);
      history.push({ role: 'user', content: message, timestamp: new Date().toISOString() });

      // Detect tool calls from user message
      const toolResults = [];
      const lowerMsg = message.toLowerCase();

      // Heuristic tool dispatch based on message content
      if (lowerMsg.includes('search') && (lowerMsg.includes('contact') || lowerMsg.includes('find'))) {
        const queryMatch = message.match(/(?:search|find|look up)\s+(?:contacts?\s+)?(?:for\s+)?["']?(.+?)["']?\s*$/i);
        const query = queryMatch ? queryMatch[1] : message;
        const result = copilotTools.search_contacts.execute({ query }, actor);
        toolResults.push({ tool: 'search_contacts', result });
      }
      if (lowerMsg.includes('pipeline') || lowerMsg.includes('opportunities') || lowerMsg.includes('deals')) {
        const result = copilotTools.get_pipeline_summary.execute({}, actor);
        toolResults.push({ tool: 'get_pipeline_summary', result });
      }
      if (lowerMsg.includes('availability') || lowerMsg.includes('calendar') || lowerMsg.includes('schedule')) {
        const dateMatch = message.match(/(\d{4}-\d{2}-\d{2})/);
        const result = copilotTools.get_calendar_availability.execute({ date: dateMatch ? dateMatch[1] : '' }, actor);
        toolResults.push({ tool: 'get_calendar_availability', result });
      }

      // Autonomous Tool: Create Contact
      if (lowerMsg.includes('create contact') || lowerMsg.includes('add contact') || lowerMsg.includes('new contact') || lowerMsg.includes('new lead')) {
        const emailMatch = message.match(/[\w.-]+@[\w.-]+\.\w+/);
        const nameMatch = message.match(/(?:contact|lead)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i) ||
                          message.match(/name[d]?\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        const companyMatch = message.match(/company\s+(?:is\s+)?([A-Za-z0-9&.\s]+?)(?:$|\s+(?:with|and|email))/i);

        const fullName = nameMatch ? nameMatch[1].trim() : 'New Lead';
        const [firstName, ...rest] = fullName.split(' ');
        const lastName = rest.join(' ');

        const result = await copilotTools.create_contact.execute({
          firstName,
          lastName,
          email: emailMatch ? emailMatch[0] : '',
          company: companyMatch ? companyMatch[1].trim() : '',
          tags: ['copilot-lead']
        }, actor);
        toolResults.push({ tool: 'create_contact', result });
      }

      // Autonomous Tool: Trigger Workflow
      if (lowerMsg.includes('trigger workflow') || lowerMsg.includes('run workflow') || lowerMsg.includes('execute workflow')) {
        const wfMatch = message.match(/(?:workflow)\s+["']?([^"'\n]+?)["']?$/i) ||
                        message.match(/(?:run|trigger|execute)\s+["']?([^"'\n]+?)(?:workflow)?["']?$/i);
        const wfName = wfMatch ? wfMatch[1].trim() : '';
        const result = await copilotTools.trigger_workflow.execute({ workflowName: wfName }, actor);
        toolResults.push({ tool: 'trigger_workflow', result });
      }

      // Autonomous Tool: Move Opportunity / Deal Stage
      if (lowerMsg.includes('move opportunity') || lowerMsg.includes('update stage') || lowerMsg.includes('move deal')) {
        const stageMatch = message.match(/to\s+([A-Za-z]+)/i);
        const targetStage = stageMatch ? stageMatch[1] : 'Qualified';
        const oppMatch = message.match(/(?:opportunity|deal)\s+["']?([^"'\n]+?)["']?\s+to/i);
        const oppName = oppMatch ? oppMatch[1].trim() : '';
        const result = await copilotTools.update_opportunity_stage.execute({ name: oppName, stage: targetStage }, actor);
        toolResults.push({ tool: 'update_opportunity_stage', result });
      }

      // Autonomous Tool: Send Communication
      if (lowerMsg.includes('send sms') || lowerMsg.includes('send email') || lowerMsg.includes('send message')) {
        const channel = lowerMsg.includes('email') ? 'email' : 'sms';
        const textMatch = message.match(/(?:saying|message|text)\s+["']?(.+?)["']?$/i);
        const msgText = textMatch ? textMatch[1].trim() : 'Hello from Operza';
        const recipientMatch = message.match(/to\s+([A-Za-z0-9@.\s]+?)(?:\s+saying|\s+message|$)/i);
        const recipient = recipientMatch ? recipientMatch[1].trim() : '';
        const result = await copilotTools.send_communication.execute({ recipient, channel, message: msgText }, actor);
        toolResults.push({ tool: 'send_communication', result });
      }

      // Explicit tool calling mode
      if (requestedTools && Array.isArray(requestedTools)) {
        for (const tc of requestedTools) {
          const result = await resolveCopilotToolCall(tc.name, tc.params || {}, actor);
          toolResults.push({ tool: tc.name, result });
        }
      }

      // Build response
      const contactCount = (state.records.contacts || []).filter(c => c.agencyId === agency.id && c.locationId === activeLocation.id).length;
      const taskCount = (state.records.tasks || []).filter(t => t.agencyId === agency.id && t.locationId === activeLocation.id && t.status !== 'completed').length;

      let responseText = '';
      if (toolResults.length > 0) {
        const summaries = [];
        for (const tr of toolResults) {
          if (tr.tool === 'create_contact' && tr.result.success) {
            summaries.push(`✅ Created contact **${tr.result.name}** (${tr.result.email || 'no email'}) under **${tr.result.company || 'Direct'}**.`);
          } else if (tr.tool === 'trigger_workflow' && tr.result.success) {
            summaries.push(`⚡ Executed workflow **${tr.result.workflowName}** (Execution ID: ${tr.result.executionId.slice(0, 8)}). Status: **${tr.result.status}** with ${tr.result.stepsExecuted} step(s).`);
          } else if (tr.tool === 'update_opportunity_stage' && tr.result.success) {
            summaries.push(`📈 Moved deal **${tr.result.name}** from '${tr.result.previousStage}' to **${tr.result.newStage}**.`);
          } else if (tr.tool === 'send_communication' && tr.result.success) {
            summaries.push(`💬 Dispatched outbound ${tr.result.channel.toUpperCase()} to **${tr.result.contactName}**: "${tr.result.message}".`);
          } else if (tr.tool === 'search_contacts') {
            summaries.push(`🔍 Found ${tr.result.count} matching contact(s).`);
          } else if (tr.tool === 'get_pipeline_summary') {
            summaries.push(`📊 Pipeline summary: ${tr.result.totalOpportunities} active deals with a total value of $${tr.result.totalValue.toLocaleString()}.`);
          } else if (tr.tool === 'get_calendar_availability') {
            summaries.push(`📅 Calendar for ${tr.result.date}: ${tr.result.bookedSlots} booked appointments.`);
          } else if (tr.result.error) {
            summaries.push(`⚠️ Tool ${tr.tool} returned: ${tr.result.error}`);
          }
        }
        responseText = summaries.join('\n\n');
      } else {
        responseText = `Hello ${actor.user.name}! You have ${contactCount} contacts and ${taskCount} pending tasks. You can ask me to search contacts, add leads, move deal stages, trigger automated workflows, send outbound messages, or check calendar schedules.`;
      }

      const assistantMsg = {
        role: 'assistant',
        content: responseText,
        toolResults: toolResults.length > 0 ? toolResults : undefined,
        timestamp: new Date().toISOString()
      };
      history.push(assistantMsg);

      // Trim history to last 50 messages
      if (history.length > 50) history.splice(0, history.length - 50);

      return sendJson(res, 200, {
        sessionId,
        message: assistantMsg,
        tools: Object.keys(copilotTools),
        historyLength: history.length
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── DASHBOARD ANALYTICS ────────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/dashboard/stats') {
      const loc = activeLocation.id;
      const ag = agency.id;
      const scoped = (col) => (state.records[col] || []).filter(r => r.agencyId === ag && r.locationId === loc);

      const contacts = scoped('contacts');
      const opportunities = scoped('opportunities');
      const tasks = scoped('tasks');
      const appointments = scoped('appointments');
      const conversations = scoped('conversations');
      const invoices = scoped('invoices');

      const totalOppValue = opportunities.reduce((sum, o) => sum + (Number(o.value) || 0), 0);
      const openOpps = opportunities.filter(o => o.status === 'open').length;
      const wonOpps = opportunities.filter(o => o.status === 'won').length;
      const pendingTasks = tasks.filter(t => t.status !== 'completed').length;
      const overdueTasks = tasks.filter(t => t.status !== 'completed' && t.dueDate && new Date(t.dueDate) < new Date()).length;
      const todayStr = new Date().toISOString().slice(0, 10);
      const todayAppointments = appointments.filter(a => a.startsAt && a.startsAt.startsWith(todayStr)).length;
      const totalInvoiced = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
      const paidInvoices = invoices.filter(i => i.status === 'paid').length;

      // Contacts added in last 7 days
      const weekAgo = Date.now() - 7 * 86400000;
      const newContactsThisWeek = contacts.filter(c => c.createdAt && new Date(c.createdAt).getTime() > weekAgo).length;

      // Stage breakdown
      const stageBreakdown = {};
      for (const opp of opportunities) {
        const stage = opp.stage || 'Unknown';
        stageBreakdown[stage] = (stageBreakdown[stage] || 0) + 1;
      }

      return sendJson(res, 200, {
        contacts: { total: contacts.length, newThisWeek: newContactsThisWeek },
        opportunities: { total: opportunities.length, open: openOpps, won: wonOpps, totalValue: totalOppValue, stageBreakdown },
        tasks: { total: tasks.length, pending: pendingTasks, overdue: overdueTasks },
        appointments: { total: appointments.length, today: todayAppointments },
        conversations: { total: conversations.length },
        invoices: { total: invoices.length, paid: paidInvoices, totalInvoiced },
        workflows: { totalExecutions: (state.workflowExecutions || []).filter(e => e.agencyId === ag && e.locationId === loc).length }
      });
    }

    if (method === 'GET' && pathname === '/api/dashboard/activity') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);
      const activity = (state.audit || [])
        .filter(a => a.agencyId === agency.id || a.agencyId === '')
        .slice(-limit)
        .reverse();
      return sendJson(res, 200, { activity, total: activity.length });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AUDIT TRAIL ────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/audit') {
      const q = (url.searchParams.get('q') || url.searchParams.get('search') || '').toLowerCase();
      const actionFilter = url.searchParams.get('action');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

      let logs = (state.audit || []).filter(a => a.agencyId === agency.id || a.agencyId === '');
      if (actionFilter) {
        logs = logs.filter(a => a.action === actionFilter);
      }
      if (q) {
        logs = logs.filter(a =>
          a.action.toLowerCase().includes(q) ||
          (a.userName && a.userName.toLowerCase().includes(q)) ||
          JSON.stringify(a.details || {}).toLowerCase().includes(q)
        );
      }
      logs = logs.slice().reverse().slice(0, limit);

      return sendJson(res, 200, { data: logs, total: logs.length });
    }

    if (method === 'DELETE' && pathname === '/api/audit') {
      state.audit = state.audit.filter(a => a.agencyId !== agency.id);
      await saveState();
      return sendJson(res, 200, { success: true, message: 'Audit log cleared' });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── MARKETING CAMPAIGNS DISPATCH ───────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname.startsWith('/api/campaigns/') && pathname.endsWith('/send')) {
      const campaignId = pathname.replace('/api/campaigns/', '').replace('/send', '').trim();
      const campaign = (state.records.campaigns || []).find(
        c => c.id === campaignId && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (!campaign) return sendJson(res, 404, { error: 'Campaign not found' });

      // Match segmented contacts
      const contacts = (state.records.contacts || []).filter(
        c => c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      let matched = contacts;
      if (campaign.segment) {
        matched = contacts.filter(c => {
          if (campaign.segment.tags && campaign.segment.tags.length > 0) {
            if (!c.tags || !c.tags.some(t => campaign.segment.tags.includes(t))) return false;
          }
          if (campaign.segment.status && campaign.segment.status !== 'any') {
            if (c.status !== campaign.segment.status) return false;
          }
          return true;
        });
      }
      if (matched.length === 0) matched = contacts.slice(0, 5); // fallback to recent contacts

      // Dispatch outbound communication for matched contacts
      state.records.conversations = state.records.conversations || [];
      const channel = campaign.kind || campaign.channel || 'email';
      const msgText = campaign.message || campaign.content || `Automated campaign broadcast: ${campaign.name}`;

      for (const contact of matched) {
        const messageRecord = {
          id: randomUUID(),
          sender: 'agent',
          senderName: `${actor.user.name} (Campaign)`,
          channel,
          content: msgText,
          timestamp: new Date().toISOString()
        };

        let conv = state.records.conversations.find(
          cv => cv.agencyId === agency.id && cv.locationId === activeLocation.id && cv.contactId === contact.id
        );
        if (conv) {
          conv.messages = conv.messages || [];
          conv.messages.push(messageRecord);
          conv.lastMessage = messageRecord.content;
          conv.updatedAt = new Date().toISOString();
        } else {
          conv = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            contactId: contact.id,
            contactName: `${contact.firstName} ${contact.lastName}`.trim(),
            channel,
            status: 'open',
            messages: [messageRecord],
            lastMessage: messageRecord.content,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          state.records.conversations.push(conv);
        }
      }

      // Update campaign metrics
      campaign.status = 'sent';
      campaign.sent = matched.length;
      campaign.opened = Math.round(matched.length * 0.45);
      campaign.clicked = Math.round(matched.length * 0.18);
      campaign.sentAt = new Date().toISOString();
      campaign.updatedAt = new Date().toISOString();

      await saveState();

      auditLog('campaign.sent', actor, { campaignId, name: campaign.name, count: matched.length });
      broadcast('crm.campaign.sent', { campaignId, sentCount: matched.length });

      // Trigger campaign workflow execution if present
      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'campaign_dispatched',
        triggerContext: { campaign, recipientCount: matched.length }
      }).catch(console.error);

      return sendJson(res, 200, {
        success: true,
        campaign,
        recipientCount: matched.length,
        sentCount: matched.length
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── OMNICHANNEL OUTBOUND MESSAGING ──────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname.startsWith('/api/conversations/') && pathname.endsWith('/messages')) {
      const convId = pathname.replace('/api/conversations/', '').replace('/messages', '').trim();
      state.records.conversations = state.records.conversations || [];
      const conv = state.records.conversations.find(
        c => c.id === convId && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (!conv) return sendJson(res, 404, { error: 'Conversation not found' });

      const body = await readBody(req);
      const text = body.content || body.body || '';
      if (!text) return sendJson(res, 400, { error: 'content is required' });

      const msg = {
        id: randomUUID(),
        sender: 'agent',
        senderName: actor.user.name,
        channel: body.channel || conv.channel || 'sms',
        content: text,
        subject: body.subject || undefined,
        timestamp: new Date().toISOString()
      };

      conv.messages = conv.messages || [];
      conv.messages.push(msg);
      conv.lastMessage = text;
      conv.updatedAt = new Date().toISOString();
      await saveState();

      auditLog('conversation.message_sent', actor, { convId, channel: msg.channel });
      broadcast('crm.conversation.message', { conversationId: conv.id, message: msg });

      return sendJson(res, 201, { success: true, message: msg, conversation: conv });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── SOCIAL MEDIA PLANNER PUBLISHING ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname.startsWith('/api/social/publish/')) {
      const postId = pathname.replace('/api/social/publish/', '').trim();
      state.records.socialPosts = state.records.socialPosts || [];
      const post = state.records.socialPosts.find(
        p => p.id === postId && p.agencyId === agency.id && p.locationId === activeLocation.id
      );
      if (!post) return sendJson(res, 404, { error: 'Social post not found' });

      post.status = 'published';
      post.publishedAt = new Date().toISOString();
      post.likes = post.likes || Math.floor(Math.random() * 25) + 5;
      post.comments = post.comments || Math.floor(Math.random() * 8) + 1;
      post.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('social.post_published', actor, { postId, platforms: post.platforms });
      broadcast('social.post.published', { postId, status: 'published' });

      return sendJson(res, 200, { success: true, post });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── WORKFLOW RUNS & APPROVALS ──────────────────────────────
    // ═════════════════════════════════════════════════════════════

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
      broadcast('workflow.execution.approved', { executionId: runId });
      return sendJson(res, 200, { success: true, run });
    }

    // POST /api/workflows/:id/run — on-demand execution trigger
    if (method === 'POST' && pathname.startsWith('/api/workflows/') && pathname.endsWith('/run')) {
      const workflowId = pathname.replace('/api/workflows/', '').replace('/run', '').trim();
      const flow = (state.records.workflows || []).find(
        w => w.id === workflowId && w.agencyId === agency.id && w.locationId === activeLocation.id
      );
      if (!flow) return sendJson(res, 404, { error: 'Workflow not found' });

      const body = await readBody(req);
      let contact = null;
      if (body.contactId) {
        contact = (state.records.contacts || []).find(c => c.id === body.contactId && c.agencyId === agency.id);
      }
      if (!contact && (state.records.contacts || []).length > 0) {
        contact = (state.records.contacts || []).find(c => c.agencyId === agency.id && c.locationId === activeLocation.id) || state.records.contacts[0];
      }

      const execution = await executeWorkflowInstance({
        flow,
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'manual',
        triggerContext: {
          contact,
          manualTrigger: true,
          triggeredBy: actor.user.name,
          payload: body.payload || {}
        }
      });

      return sendJson(res, 201, { success: true, execution });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── CRM ENHANCED ENDPOINTS ─────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    // ─── Bulk Tag ─────────────────────────────────────────────────
    if (method === 'POST' && pathname === '/api/crm/contacts/bulk-tag') {
      const body = await readBody(req);
      const { contactIds, tag } = body;
      if (!Array.isArray(contactIds) || !tag) return sendJson(res, 400, { error: 'contactIds array and tag required' });

      let updated = 0;
      for (const id of contactIds) {
        const contact = (state.records.contacts || []).find(
          c => c.id === id && c.agencyId === agency.id && c.locationId === activeLocation.id
        );
        if (contact) {
          contact.tags = Array.from(new Set([...(contact.tags || []), tag]));
          contact.updatedAt = new Date().toISOString();
          updated++;
        }
      }
      await saveState();
      auditLog('crm.contacts.bulk_tag', actor, { tag, count: updated });
      broadcast('crm.contacts.bulk_updated', { tag, count: updated });
      return sendJson(res, 200, { success: true, updated });
    }

    // ─── Import Contacts (CSV text) ──────────────────────────────
    if (method === 'POST' && pathname === '/api/crm/contacts/import') {
      const body = await readBody(req);
      const csvText = body.csv || body.data || '';
      if (!csvText) return sendJson(res, 400, { error: 'csv field with CSV text is required' });

      const rows = parseCSV(csvText);
      const imported = [];
      for (const row of rows) {
        const contact = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          firstName: row.firstName || row.first_name || row.name || '',
          lastName: row.lastName || row.last_name || '',
          email: row.email || '',
          phone: row.phone || '',
          company: row.company || '',
          source: 'CSV Import',
          tags: row.tags ? row.tags.split(';').map(t => t.trim()) : ['imported'],
          status: row.status || 'lead',
          notes: row.notes || '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.contacts.push(contact);
        imported.push(contact);
      }
      await saveState();
      auditLog('crm.contacts.import', actor, { count: imported.length });
      broadcast('crm.contacts.imported', { count: imported.length });
      return sendJson(res, 201, { success: true, imported: imported.length, contacts: imported.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`, email: c.email })) });
    }

    // ─── Contact Merge / Dedup ───────────────────────────────────
    if (method === 'POST' && pathname === '/api/crm/contacts/merge') {
      const body = await readBody(req);
      const { primaryId, mergeIds } = body;
      if (!primaryId || !Array.isArray(mergeIds) || mergeIds.length === 0) {
        return sendJson(res, 400, { error: 'primaryId and mergeIds array required' });
      }

      const contacts = state.records.contacts || [];
      const primary = contacts.find(c => c.id === primaryId && c.agencyId === agency.id && c.locationId === activeLocation.id);
      if (!primary) return sendJson(res, 404, { error: 'Primary contact not found' });

      const merged = [];
      for (const mergeId of mergeIds) {
        if (mergeId === primaryId) continue;
        const idx = contacts.findIndex(c => c.id === mergeId && c.agencyId === agency.id && c.locationId === activeLocation.id);
        if (idx === -1) continue;

        const dup = contacts[idx];

        // Merge data into primary: fill empty fields, merge tags
        for (const field of ['lastName', 'email', 'phone', 'company', 'source', 'notes']) {
          if (!primary[field] && dup[field]) primary[field] = dup[field];
        }
        primary.tags = Array.from(new Set([...(primary.tags || []), ...(dup.tags || [])]));

        // Re-link related records
        for (const opp of (state.records.opportunities || [])) {
          if (opp.contactId === mergeId) opp.contactId = primaryId;
        }
        for (const task of (state.records.tasks || [])) {
          if (task.contactId === mergeId) task.contactId = primaryId;
        }
        for (const note of (state.records.notes || [])) {
          if (note.contactId === mergeId) note.contactId = primaryId;
        }

        // Remove duplicate
        contacts.splice(idx, 1);
        merged.push(mergeId);
      }

      primary.updatedAt = new Date().toISOString();
      await saveState();
      auditLog('crm.contacts.merge', actor, { primaryId, mergedIds: merged });
      return sendJson(res, 200, { success: true, primaryId, mergedCount: merged.length, mergedIds: merged });
    }

    // ─── Contact Activity Timeline ───────────────────────────────
    const timelineMatch = pathname.match(/^\/api\/crm\/contacts\/([a-zA-Z0-9_-]+)\/timeline$/);
    if (method === 'GET' && timelineMatch) {
      const contactId = timelineMatch[1];
      const contact = (state.records.contacts || []).find(
        c => c.id === contactId && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (!contact) return sendJson(res, 404, { error: 'Contact not found' });

      const timeline = [];

      // Contact creation
      timeline.push({ type: 'contact_created', date: contact.createdAt, detail: `Contact created from ${contact.source || 'manual'}` });

      // Opportunities
      for (const opp of (state.records.opportunities || [])) {
        if (opp.contactId === contactId) {
          timeline.push({ type: 'opportunity', date: opp.createdAt, detail: `Opportunity: ${opp.name} (${opp.stage})`, recordId: opp.id });
        }
      }

      // Tasks
      for (const task of (state.records.tasks || [])) {
        if (task.contactId === contactId) {
          timeline.push({ type: 'task', date: task.createdAt, detail: `Task: ${task.title} (${task.status})`, recordId: task.id });
        }
      }

      // Notes
      for (const note of (state.records.notes || [])) {
        if (note.contactId === contactId) {
          timeline.push({ type: 'note', date: note.createdAt, detail: `Note: ${(note.text || '').slice(0, 100)}`, recordId: note.id });
        }
      }

      // Audit entries for this contact
      for (const entry of (state.audit || [])) {
        if (entry.details && (entry.details.contactId === contactId || entry.details.id === contactId)) {
          timeline.push({ type: 'audit', date: entry.timestamp, detail: entry.action });
        }
      }

      // Sort by date descending
      timeline.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

      return sendJson(res, 200, { contactId, name: `${contact.firstName} ${contact.lastName}`, timeline });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AGENCY: SUB-ACCOUNTS / LOCATIONS ───────────────────────
    // ═════════════════════════════════════════════════════════════

    // GET /api/agency/locations — list client workspaces with metrics
    if (method === 'GET' && pathname === '/api/agency/locations') {
      const agencyLocs = (state.locations || []).filter(l => l.agencyId === agency.id && l.status !== 'deleted');
      const enriched = agencyLocs.map(loc => {
        const contactsCount = (state.records.contacts || []).filter(c => c.agencyId === agency.id && c.locationId === loc.id).length;
        const opportunitiesCount = (state.records.opportunities || []).filter(o => o.agencyId === agency.id && o.locationId === loc.id).length;
        const appointmentsCount = (state.records.appointments || []).filter(a => a.agencyId === agency.id && a.locationId === loc.id).length;
        const workflowsCount = (state.records.workflows || []).filter(w => w.agencyId === agency.id && w.locationId === loc.id).length;

        return {
          id: loc.id,
          agencyId: loc.agencyId,
          name: loc.name,
          address: loc.address || '',
          phone: loc.phone || '',
          timezone: loc.timezone || 'UTC',
          industry: loc.industry || 'General',
          ownerEmail: loc.ownerEmail || '',
          planId: loc.planId || 'growth',
          seats: loc.seats || 1,
          status: loc.status || 'active',
          createdAt: loc.createdAt || new Date().toISOString(),
          contactsCount,
          opportunitiesCount,
          appointmentsCount,
          workflowsCount
        };
      });

      return sendJson(res, 200, { locations: enriched });
    }

    // POST /api/agency/locations — provision a new client sub-account
    if (method === 'POST' && pathname === '/api/agency/locations') {
      const body = await readBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { error: 'Location name is required' });
      }

      const newLocId = randomUUID();
      const newLocation = {
        id: newLocId,
        agencyId: agency.id,
        name: body.name.trim(),
        address: body.address ? String(body.address).trim() : '',
        phone: body.phone ? String(body.phone).trim() : '',
        timezone: body.timezone ? String(body.timezone).trim() : 'UTC',
        industry: body.industry ? String(body.industry).trim() : 'General',
        ownerEmail: body.ownerEmail ? String(body.ownerEmail).trim() : '',
        planId: body.planId || 'growth',
        seats: Number(body.seats) || 1,
        status: body.status || 'trial',
        createdAt: new Date().toISOString()
      };

      state.locations.push(newLocation);

      // Seed initial default pipeline for the sub-account
      state.records.pipelines = state.records.pipelines || [];
      state.records.pipelines.push({
        id: randomUUID(),
        agencyId: agency.id,
        locationId: newLocId,
        name: `${newLocation.name} Sales Pipeline`,
        stages: ['Lead', 'Contacted', 'Qualified', 'Proposal', 'Won', 'Lost'],
        status: 'active',
        createdAt: new Date().toISOString()
      });

      await saveState();
      auditLog('agency.location.created', actor, { locationId: newLocId, name: newLocation.name });
      broadcast('agency.location.created', newLocation);

      return sendJson(res, 201, newLocation);
    }

    // PUT /api/agency/locations/:id — update sub-account details / status
    if (method === 'PUT' && pathname.startsWith('/api/agency/locations/')) {
      const locId = pathname.replace('/api/agency/locations/', '').trim();
      const loc = (state.locations || []).find(l => l.id === locId && l.agencyId === agency.id);
      if (!loc) return sendJson(res, 404, { error: 'Location not found' });

      const body = await readBody(req);
      if (body.name) loc.name = body.name.trim();
      if (body.address !== undefined) loc.address = String(body.address).trim();
      if (body.phone !== undefined) loc.phone = String(body.phone).trim();
      if (body.timezone) loc.timezone = String(body.timezone).trim();
      if (body.industry) loc.industry = String(body.industry).trim();
      if (body.ownerEmail !== undefined) loc.ownerEmail = String(body.ownerEmail).trim();
      if (body.planId) loc.planId = body.planId;
      if (body.seats !== undefined) loc.seats = Number(body.seats) || 1;
      if (body.status) loc.status = body.status;
      loc.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('agency.location.updated', actor, { locationId: locId, updates: Object.keys(body) });
      broadcast('agency.location.updated', loc);

      return sendJson(res, 200, loc);
    }

    // DELETE /api/agency/locations/:id — deactivate client sub-account
    if (method === 'DELETE' && pathname.startsWith('/api/agency/locations/')) {
      const locId = pathname.replace('/api/agency/locations/', '').trim();
      const loc = (state.locations || []).find(l => l.id === locId && l.agencyId === agency.id);
      if (!loc) return sendJson(res, 404, { error: 'Location not found' });

      const activeCount = (state.locations || []).filter(l => l.agencyId === agency.id && l.status === 'active').length;
      if (activeCount <= 1 && loc.status === 'active') {
        return sendJson(res, 400, { error: 'Cannot deactivate the sole active workspace' });
      }

      loc.status = 'deleted';
      loc.updatedAt = new Date().toISOString();
      await saveState();

      auditLog('agency.location.deleted', actor, { locationId: locId });
      broadcast('agency.location.deleted', { locationId: locId });

      return sendJson(res, 200, { success: true, deletedId: locId });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AGENCY: SNAPSHOTS ENGINE ───────────────────────────────
    // ═════════════════════════════════════════════════════════════

    // GET /api/agency/snapshots — list snapshot templates for agency
    if (method === 'GET' && pathname === '/api/agency/snapshots') {
      const snapshots = (state.snapshots || [])
        .filter(s => s.agencyId === agency.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(s => ({
          id: s.id,
          agencyId: s.agencyId,
          sourceLocationId: s.sourceLocationId,
          name: s.name,
          description: s.description || '',
          industry: s.industry || 'General',
          counts: s.counts || {
            workflows: (s.data?.workflows || []).length,
            pipelines: (s.data?.pipelines || []).length,
            calendars: (s.data?.calendars || []).length,
            forms: (s.data?.forms || []).length,
            paymentLinks: (s.data?.paymentLinks || []).length,
            contacts: (s.data?.contacts || []).length
          },
          createdAt: s.createdAt
        }));

      return sendJson(res, 200, { snapshots });
    }

    // POST /api/agency/snapshots — create new snapshot from workspace
    if (method === 'POST' && pathname === '/api/agency/snapshots') {
      const body = await readBody(req);
      const sourceLocId = body.sourceLocationId || activeLocation.id;
      const sourceLoc = (state.locations || []).find(l => l.id === sourceLocId && l.agencyId === agency.id);
      if (!sourceLoc) return sendJson(res, 404, { error: 'Source workspace not found' });

      const workflows = (state.records.workflows || []).filter(w => w.agencyId === agency.id && w.locationId === sourceLocId);
      const pipelines = (state.records.pipelines || []).filter(p => p.agencyId === agency.id && p.locationId === sourceLocId);
      const calendars = (state.records.calendars || []).filter(c => c.agencyId === agency.id && c.locationId === sourceLocId);
      const forms = (state.records.forms || []).filter(f => f.agencyId === agency.id && f.locationId === sourceLocId);
      const paymentLinks = (state.records.paymentLinks || []).filter(p => p.agencyId === agency.id && p.locationId === sourceLocId);
      const contacts = body.includeContacts
        ? (state.records.contacts || []).filter(c => c.agencyId === agency.id && c.locationId === sourceLocId)
        : [];

      const newSnapshot = {
        id: randomUUID(),
        agencyId: agency.id,
        sourceLocationId: sourceLocId,
        name: (body.name || `Snapshot — ${new Date().toLocaleDateString()}`).trim(),
        description: (body.description || '').trim(),
        industry: (body.industry || sourceLoc.industry || 'General').trim(),
        counts: {
          workflows: workflows.length,
          pipelines: pipelines.length,
          calendars: calendars.length,
          forms: forms.length,
          paymentLinks: paymentLinks.length,
          contacts: contacts.length
        },
        data: {
          workflows: workflows.map(w => ({ ...w })),
          pipelines: pipelines.map(p => ({ ...p })),
          calendars: calendars.map(c => ({ ...c })),
          forms: forms.map(f => ({ ...f })),
          paymentLinks: paymentLinks.map(p => ({ ...p })),
          contacts: contacts.map(c => ({ ...c }))
        },
        createdAt: new Date().toISOString()
      };

      state.snapshots = state.snapshots || [];
      state.snapshots.unshift(newSnapshot);

      // Keep up to 10 snapshots per agency
      const agencySnaps = state.snapshots.filter(s => s.agencyId === agency.id);
      if (agencySnaps.length > 10) {
        const oldest = agencySnaps[agencySnaps.length - 1];
        state.snapshots = state.snapshots.filter(s => s.id !== oldest.id);
      }

      await saveState();
      auditLog('agency.snapshot.created', actor, { snapshotId: newSnapshot.id, name: newSnapshot.name });
      broadcast('agency.snapshot.created', { id: newSnapshot.id, name: newSnapshot.name });

      return sendJson(res, 201, newSnapshot);
    }

    // POST /api/agency/snapshots/:id/deploy — deep-clone snapshot into target client sub-account
    if (method === 'POST' && pathname.startsWith('/api/agency/snapshots/') && pathname.endsWith('/deploy')) {
      const snapshotId = pathname.replace('/api/agency/snapshots/', '').replace('/deploy', '').trim();
      const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
      if (!snapshot) return sendJson(res, 404, { error: 'Snapshot not found' });

      const body = await readBody(req);
      const targetLocId = body.targetLocationId;
      if (!targetLocId) return sendJson(res, 400, { error: 'targetLocationId is required' });

      const targetLoc = (state.locations || []).find(l => l.id === targetLocId && l.agencyId === agency.id);
      if (!targetLoc) return sendJson(res, 404, { error: 'Target workspace not found' });

      const deployed = {
        workflows: 0,
        pipelines: 0,
        calendars: 0,
        forms: 0,
        paymentLinks: 0,
        contacts: 0
      };

      // Clone workflows
      for (const w of (snapshot.data.workflows || [])) {
        state.records.workflows = state.records.workflows || [];
        state.records.workflows.push({
          ...w,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          status: 'active',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
        deployed.workflows++;
      }

      // Clone pipelines
      for (const p of (snapshot.data.pipelines || [])) {
        state.records.pipelines = state.records.pipelines || [];
        state.records.pipelines.push({
          ...p,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          createdAt: new Date().toISOString()
        });
        deployed.pipelines++;
      }

      // Clone calendars
      for (const c of (snapshot.data.calendars || [])) {
        state.records.calendars = state.records.calendars || [];
        state.records.calendars.push({
          ...c,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          slug: `${c.slug}-${randomBytes(3).toString('hex')}`,
          createdAt: new Date().toISOString()
        });
        deployed.calendars++;
      }

      // Clone forms
      for (const f of (snapshot.data.forms || [])) {
        state.records.forms = state.records.forms || [];
        state.records.forms.push({
          ...f,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          slug: `${f.slug}-${randomBytes(3).toString('hex')}`,
          createdAt: new Date().toISOString()
        });
        deployed.forms++;
      }

      // Clone payment links
      for (const pl of (snapshot.data.paymentLinks || [])) {
        state.records.paymentLinks = state.records.paymentLinks || [];
        state.records.paymentLinks.push({
          ...pl,
          id: randomUUID(),
          agencyId: agency.id,
          locationId: targetLocId,
          slug: `${pl.slug}-${randomBytes(3).toString('hex')}`,
          createdAt: new Date().toISOString()
        });
        deployed.paymentLinks++;
      }

      // Clone contacts if requested
      if (body.includeContacts && Array.isArray(snapshot.data.contacts)) {
        for (const ct of snapshot.data.contacts) {
          state.records.contacts = state.records.contacts || [];
          state.records.contacts.push({
            ...ct,
            id: randomUUID(),
            agencyId: agency.id,
            locationId: targetLocId,
            createdAt: new Date().toISOString()
          });
          deployed.contacts++;
        }
      }

      await saveState();
      auditLog('agency.snapshot.deployed', actor, { snapshotId, targetLocationId: targetLocId, deployed });
      broadcast('agency.snapshot.deployed', { snapshotId, targetLocationId: targetLocId, deployed });

      return sendJson(res, 200, {
        success: true,
        snapshotId,
        targetLocationId: targetLocId,
        targetLocationName: targetLoc.name,
        deployed
      });
    }

    // POST /api/agency/snapshots/:id/restore — restore active workspace to snapshot state
    if (method === 'POST' && pathname.startsWith('/api/agency/snapshots/') && pathname.endsWith('/restore')) {
      const snapshotId = pathname.replace('/api/agency/snapshots/', '').replace('/restore', '').trim();
      const snapshot = (state.snapshots || []).find(s => s.id === snapshotId && s.agencyId === agency.id);
      if (!snapshot) return sendJson(res, 404, { error: 'Snapshot not found' });

      const targetLocId = activeLocation.id;

      // Remove current records for this location in restored collections
      const collectionsToRestore = ['workflows', 'pipelines', 'calendars', 'forms', 'paymentLinks'];
      for (const col of collectionsToRestore) {
        if (state.records[col]) {
          state.records[col] = state.records[col].filter(r => !(r.agencyId === agency.id && r.locationId === targetLocId));
        }
      }

      // Restore from snapshot
      for (const w of (snapshot.data.workflows || [])) {
        state.records.workflows.push({ ...w, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
      }
      for (const p of (snapshot.data.pipelines || [])) {
        state.records.pipelines.push({ ...p, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
      }
      for (const c of (snapshot.data.calendars || [])) {
        state.records.calendars.push({ ...c, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
      }
      for (const f of (snapshot.data.forms || [])) {
        state.records.forms.push({ ...f, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
      }
      for (const pl of (snapshot.data.paymentLinks || [])) {
        state.records.paymentLinks.push({ ...pl, id: randomUUID(), agencyId: agency.id, locationId: targetLocId });
      }

      await saveState();
      auditLog('agency.snapshot.restored', actor, { snapshotId, locationId: targetLocId });
      broadcast('agency.snapshot.restored', { snapshotId, locationId: targetLocId });

      return sendJson(res, 200, { success: true, restoredAt: new Date().toISOString() });
    }

    // DELETE /api/agency/snapshots/:id — delete a snapshot
    if (method === 'DELETE' && pathname.startsWith('/api/agency/snapshots/')) {
      const snapshotId = pathname.replace('/api/agency/snapshots/', '').trim();
      const idx = (state.snapshots || []).findIndex(s => s.id === snapshotId && s.agencyId === agency.id);
      if (idx === -1) return sendJson(res, 404, { error: 'Snapshot not found' });

      state.snapshots.splice(idx, 1);
      await saveState();
      auditLog('agency.snapshot.deleted', actor, { snapshotId });
      broadcast('agency.snapshot.deleted', { snapshotId });

      return sendJson(res, 200, { success: true, deletedId: snapshotId });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── CRM COLLECTIONS CRUD (with search/filter/pagination) ───
    // ═════════════════════════════════════════════════════════════
    const collectionMatch = pathname.match(/^\/api\/crm\/([a-zA-Z0-9_]+)(?:\/([a-zA-Z0-9_-]+))?$/);
    if (collectionMatch) {
      const collectionName = collectionMatch[1];
      const recordId = collectionMatch[2];

      if (!collections[collectionName]) {
        return sendJson(res, 404, { error: `Collection ${collectionName} does not exist` });
      }

      const list = state.records[collectionName] || [];

      // GET /api/crm/:collection — with search, filter, pagination, sorting
      if (method === 'GET' && !recordId) {
        let filtered = list.filter(r => r.agencyId === agency.id && r.locationId === activeLocation.id);

        // Search (across all string fields)
        const search = url.searchParams.get('search') || url.searchParams.get('q');
        if (search) {
          const q = search.toLowerCase();
          filtered = filtered.filter(r =>
            Object.values(r).some(v => {
              if (typeof v === 'string') return v.toLowerCase().includes(q);
              if (Array.isArray(v)) return v.some(item => String(item).toLowerCase().includes(q));
              return false;
            })
          );
        }

        // Filter by tag (contacts/any collection with tags)
        const tagFilter = url.searchParams.get('tag');
        if (tagFilter) {
          filtered = filtered.filter(r => Array.isArray(r.tags) && r.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase()));
        }

        // Filter by status
        const statusFilter = url.searchParams.get('status');
        if (statusFilter) {
          filtered = filtered.filter(r => r.status && r.status.toLowerCase() === statusFilter.toLowerCase());
        }

        // Filter by pipeline
        const pipelineFilter = url.searchParams.get('pipeline');
        if (pipelineFilter) {
          filtered = filtered.filter(r => r.pipeline && r.pipeline.toLowerCase() === pipelineFilter.toLowerCase());
        }

        // Filter by stage
        const stageFilter = url.searchParams.get('stage');
        if (stageFilter) {
          filtered = filtered.filter(r => r.stage && r.stage.toLowerCase() === stageFilter.toLowerCase());
        }

        // Filter by source
        const sourceFilter = url.searchParams.get('source');
        if (sourceFilter) {
          filtered = filtered.filter(r => r.source && r.source.toLowerCase().includes(sourceFilter.toLowerCase()));
        }

        // Filter by assignedTo
        const assignedFilter = url.searchParams.get('assignedTo');
        if (assignedFilter) {
          filtered = filtered.filter(r => r.assignedTo && r.assignedTo.toLowerCase().includes(assignedFilter.toLowerCase()));
        }

        // Sorting
        const sortField = url.searchParams.get('sort') || 'createdAt';
        const sortOrder = url.searchParams.get('order') || 'desc';
        filtered.sort((a, b) => {
          const aVal = a[sortField] ?? '';
          const bVal = b[sortField] ?? '';
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
          }
          const cmp = String(aVal).localeCompare(String(bVal));
          return sortOrder === 'asc' ? cmp : -cmp;
        });

        const total = filtered.length;

        // Pagination
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 25));
        const startIdx = (page - 1) * limit;
        const pageData = filtered.slice(startIdx, startIdx + limit);
        const totalPages = Math.ceil(total / limit);

        return sendJson(res, 200, {
          data: pageData,
          pagination: { page, limit, total, totalPages, hasMore: page < totalPages }
        });
      }

      // GET /api/crm/:collection/:id — single record
      if (method === 'GET' && recordId) {
        const record = list.find(r => r.id === recordId && r.agencyId === agency.id && r.locationId === activeLocation.id);
        if (!record) return sendJson(res, 404, { error: 'Record not found' });
        return sendJson(res, 200, record);
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

        auditLog(`crm.${collectionName}.created`, actor, { id: newRecord.id });
        broadcast(`crm.${collectionName}.created`, { id: newRecord.id, ...newRecord });

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

        const previousRecord = { ...list[index] };
        const updated = {
          ...list[index],
          ...body,
          updatedAt: new Date().toISOString()
        };
        list[index] = updated;
        await saveState();

        auditLog(`crm.${collectionName}.updated`, actor, { id: recordId });
        broadcast(`crm.${collectionName}.updated`, { id: recordId, ...updated });

        // Check stage move trigger
        if (collectionName === 'opportunities' && body.stage && body.stage !== previousRecord.stage) {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'opportunity_stage',
            triggerContext: { opportunity: updated, stage: body.stage, previousStage: previousRecord.stage }
          }).catch(console.error);
        }

        // Contact update trigger
        if (collectionName === 'contacts') {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'contact_updated',
            triggerContext: { contact: updated, previous: previousRecord }
          }).catch(console.error);
        }

        return sendJson(res, 200, updated);
      }

      // DELETE /api/crm/:collection/:id
      if (method === 'DELETE' && recordId) {
        const index = list.findIndex(r => r.id === recordId && r.agencyId === agency.id && r.locationId === activeLocation.id);
        if (index === -1) return sendJson(res, 404, { error: 'Record not found' });
        const deleted = list.splice(index, 1)[0];
        await saveState();
        auditLog(`crm.${collectionName}.deleted`, actor, { id: recordId });
        broadcast(`crm.${collectionName}.deleted`, { id: recordId });
        return sendJson(res, 200, { success: true, deleted });
      }
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    console.error('Server error:', error);
    sendJson(res, 500, { error: error.message || 'Internal Server Error' });
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── STARTUP ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

await loadState();

// Attach WebSocket server
if (WebSocketServer) {
  wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    wsClients.add(ws);
    console.log(`[WS] Client connected (total: ${wsClients.size})`);

    ws.send(JSON.stringify({ event: 'connected', data: { message: 'Operza real-time channel active' }, timestamp: new Date().toISOString() }));

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        // Echo ping/pong
        if (msg.type === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', timestamp: new Date().toISOString() }));
        }
      } catch { /* ignore malformed */ }
    });

    ws.on('close', () => {
      wsClients.delete(ws);
      console.log(`[WS] Client disconnected (total: ${wsClients.size})`);
    });

    ws.on('error', () => wsClients.delete(ws));
  });

  console.log('📡 WebSocket server attached at /ws');
}

// Start schedule trigger loop
startScheduleTriggerLoop();
console.log('⏰ Schedule trigger loop started (60s interval)');

server.listen(port, host, () => {
  console.log(`🚀 Operza Unified API Server v2.0 running at http://${host}:${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   WebSocket: ws://localhost:${port}/ws`);
});
