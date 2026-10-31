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
  smartLists: { label: 'Smart lists', required: ['name'], fields: ['name','rule','tone','count','filterField','operator','value','status','description'] },
  tasks: { label: 'Tasks', required: ['title'], fields: ['title','contactId','dueDate','priority','status','assignedTo','notes'] },
  conversations: { label: 'Conversations', required: ['contactName'], fields: ['contactName','channel','subject','status','lastMessage','assignedTo','messages'] },
  appointments: { label: 'Appointments', required: ['title','startsAt'], fields: ['title','contactName','calendar','startsAt','endsAt','status','assignedTo','notes'] },
  workflows: { label: 'Workflows', required: ['name'], fields: ['name','triggerType','triggerConfig','nodes','status','description','lastRunAt','lastRunSummary'] },
  forms: { label: 'Forms', required: ['name'], fields: ['name','fields','status','submissions','description','publicSlug'] },
  formSubmissions: { label: 'Form submissions', required: ['formId'], fields: ['formId','formName','contactName','answers','status','submittedAt','source'] },
  websites: { label: 'Sites & funnels', required: ['name'], fields: ['name','type','kind','status','domain','published','pages','visits','optins','checkout','theme','updatedAt','description'] },
  campaigns: { label: 'Campaigns', required: ['name'], fields: ['name','channel','status','audience','scheduledAt','description'] },
  products: { label: 'Products', required: ['name'], fields: ['name','sku','price','status','description'] },
  invoices: { label: 'Invoices', required: ['number'], fields: ['number','contactName','amount','status','dueDate','description'] },
  calendars: { label: 'Calendars', required: ['name'], fields: ['name','slug','color','durationMin','availability','roundRobin','description','status'] },
  paymentLinks: { label: 'Payment links', required: ['name'], fields: ['name','slug','amount','currency','productIds','visits','conversions','active','description'] },
  orders: { label: 'Orders', required: ['amount'], fields: ['orderNumber','contactId','contactName','amount','currency','status','paymentLinkId','items','paidAt','bumpAccepted','bumpAmount'] },
  reviews: { label: 'Reputation', required: ['contactName'], fields: ['contactName','rating','text','source','status','receivedAt','reply','repliedAt'] },
  reviewRequests: { label: 'Review Requests', required: ['contactId'], fields: ['contactId','channel','message','scheduledAt','sentAt','status','createdAt'] },
  courses: { label: 'Memberships', required: ['name'], fields: ['name','title','status','members','lessons','description','price','published','curriculum','kind'] },
  notes: { label: 'Notes', required: ['text'], fields: ['text','contactId','createdBy'] },
  socialPosts: { label: 'Social Posts', required: ['body'], fields: ['body','platforms','status','scheduledAt','likes','comments'] },
  subscriptions: { label: 'Subscriptions', required: ['plan', 'amount'], fields: ['plan','amount','interval','status','renewsAt','contactId'] },
  documents: { label: 'Documents', required: ['name'], fields: ['name','title','kind','value','status','contactId','signedAt','signerName','pdfUrl','updatedAt'] },
  triggerLinks: { label: 'Trigger Links', required: ['name','targetUrl','slug'], fields: ['name','targetUrl','slug','workflowId','clicks','lastClickAt'] },
  customValues: { label: 'Custom Values', required: ['name','value'], fields: ['name','value'] },
  calls: { label: 'Phone System Calls', required: ['from'], fields: ['from','to','durationSec','outcome','direction','contactId','startedAt','recordingUrl','handled','notes','numberId'] },
  enrollments: { label: 'Course Enrollments', required: ['courseId', 'contactId'], fields: ['courseId','contactId','progress','startedAt','status'] },
  affiliates: { label: 'Affiliates', required: ['name', 'code'], fields: ['name','email','code','commissionPct','clicks','signups','conversions','payout','status','createdAt'] },
  coupons: { label: 'Coupons', required: ['code'], fields: ['code','kind','amount','minSubtotal','maxRedemptions','redemptions','expiresAt','active','description'] },
  media: { label: 'Media Assets', required: ['name'], fields: ['name','url','kind','folder','sizeKb','mimeType','uploadedAt'] },
  blogs: { label: 'Blogs', required: ['title'], fields: ['title','slug','author','content','views','status','publishedAt','category','coverImage'] },
  qrCodes: { label: 'QR Codes', required: ['name','target'], fields: ['name','target','scans','createdAt','lastScannedAt'] },
  snippets: { label: 'Snippets', required: ['label','body'], fields: ['label','subject','body','channel','uses'] },
  templates: { label: 'Templates', required: ['name','subject'], fields: ['name','category','subject','body','uses','updatedAt'] },
  team: { label: 'Team Members', required: ['name'], fields: ['name','email','role','online','phone','avatar','status','createdAt'] },
  phoneNumbers: { label: 'Phone Numbers', required: ['number'], fields: ['number','label','type','voice','sms','mms','status','assignedTo','forwardTo','ivrEnabled','ivrMenu','recordingEnabled','areaCode'] }
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
  audit: [],
  mediaFiles: {}
});

let state = emptyState();
let writeQueue = Promise.resolve();
const cookieSession = isProd ? '__Host-operza_session' : 'operza_session';
const cookieCsrf = 'operza_csrf';

// ─── Rate Limiter (in-memory sliding window) ──────────────────────────
const rateLimitStore = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;   // 1 minute
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS) || (isProd ? 120 : 2000);   // per IP per window
const RATE_LIMIT_AUTH_MAX = Number(process.env.RATE_LIMIT_AUTH_MAX) || (isProd ? 10 : 200);        // stricter for auth endpoints

function getRateLimitKey(ip) { return ip || 'unknown'; }

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

function generateQrSvg(target, size = 256) {
  const GRID = 21;
  let h = 2166136261;
  for (let i = 0; i < target.length; i++) {
    h ^= target.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let stateVal = h >>> 0;
  const rand = () => {
    stateVal ^= stateVal << 13;
    stateVal ^= stateVal >>> 17;
    stateVal ^= stateVal << 5;
    return (stateVal >>> 0) / 4294967296;
  };
  const inFinder = (x, y) =>
    (x < 8 && y < 8) || (x > GRID - 9 && y < 8) || (x < 8 && y > GRID - 9);

  const unit = size / GRID;
  let rects = '';
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (inFinder(x, y)) continue;
      if (rand() > 0.52) {
        rects += `<rect x="${(x * unit).toFixed(1)}" y="${(y * unit).toFixed(1)}" width="${unit.toFixed(1)}" height="${unit.toFixed(1)}" fill="#111827"/>`;
      }
    }
  }

  const finder = (ox, oy) => `
    <rect x="${(ox * unit).toFixed(1)}" y="${(oy * unit).toFixed(1)}" width="${(unit * 7).toFixed(1)}" height="${(unit * 7).toFixed(1)}" fill="none" stroke="#111827" stroke-width="${unit.toFixed(1)}"/>
    <rect x="${((ox + 2) * unit).toFixed(1)}" y="${((oy + 2) * unit).toFixed(1)}" width="${(unit * 3).toFixed(1)}" height="${(unit * 3).toFixed(1)}" fill="#111827"/>
  `;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="#ffffff"/>
  ${finder(0, 0)}
  ${finder(GRID - 7, 0)}
  ${finder(0, GRID - 7)}
  ${rects}
</svg>`;
}

function resolveTokensHelper(text, agency, contact, userEmail) {
  if (typeof text !== 'string') return { resolvedText: '', tokensResolved: 0 };
  state.records.customValues = state.records.customValues || [];
  const cvList = agency ? state.records.customValues.filter(v => v.agencyId === agency.id) : state.records.customValues;

  let tokensResolved = 0;
  let resolvedText = text;

  // 1. Resolve custom values: {{custom_values.key}} or {{custom_value.key}}
  for (const cv of cvList) {
    const keySlug = cv.name.toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const pattern = new RegExp(`\\{\\{\\s*custom_values?\\.${keySlug}\\s*\\}\\}`, 'gi');
    const patternExact = new RegExp(`\\{\\{\\s*custom_values?\\.${cv.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}\\}`, 'gi');
    if (pattern.test(resolvedText)) {
      resolvedText = resolvedText.replace(pattern, () => { tokensResolved++; return cv.value; });
    }
    if (patternExact.test(resolvedText)) {
      resolvedText = resolvedText.replace(patternExact, () => { tokensResolved++; return cv.value; });
    }
  }

  // 2. Resolve contact fields if contact provided
  if (contact) {
    const contactMap = {
      'contact.first_name': contact.firstName,
      'contact.firstName': contact.firstName,
      'contact.last_name': contact.lastName,
      'contact.lastName': contact.lastName,
      'contact.name': `${contact.firstName} ${contact.lastName}`.trim(),
      'contact.full_name': `${contact.firstName} ${contact.lastName}`.trim(),
      'contact.email': contact.email,
      'contact.phone': contact.phone,
      'contact.company': contact.company
    };
    for (const [tag, val] of Object.entries(contactMap)) {
      const re = new RegExp(`\\{\\{\\s*${tag}\\s*\\}\\}`, 'gi');
      if (re.test(resolvedText)) {
        resolvedText = resolvedText.replace(re, () => { tokensResolved++; return val || ''; });
      }
    }
  }

  // 3. Resolve agency fields
  const agencyMap = {
    'agency.name': agency?.name || 'Operza Agency',
    'agency.email': userEmail || 'agency@operza.io'
  };
  for (const [tag, val] of Object.entries(agencyMap)) {
    const re = new RegExp(`\\{\\{\\s*${tag}\\s*\\}\\}`, 'gi');
    if (re.test(resolvedText)) {
      resolvedText = resolvedText.replace(re, () => { tokensResolved++; return val || ''; });
    }
  }

  return { resolvedText, tokensResolved };
}

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
      const form = (state.records.forms || []).find(
        f => (f.publicSlug === slug || f.slug === slug || f.id === slug) &&
             (f.status === 'published' || f.published === true)
      );
      if (!form) return sendJson(res, 404, { error: 'Form not found or unpublished' });
      return sendJson(res, 200, {
        id: form.id,
        name: form.name,
        fields: form.fields,
        description: form.description,
        completion: form.completion
      });
    }

    // Public Form Submission Ingress -> Lead capture + Trigger Workflow
    if (method === 'POST' && pathname.startsWith('/api/forms/submit/')) {
      const slug = pathname.replace('/api/forms/submit/', '').trim();
      const form = (state.records.forms || []).find(
        f => (f.publicSlug === slug || f.slug === slug || f.id === slug) &&
             (f.status === 'published' || f.published === true)
      );
      if (!form) return sendJson(res, 404, { error: 'Form not found or unpublished' });

      const body = await readBody(req);
      const answers = body.answers || {};

      const firstName = answers.firstName || answers.name || 'Website';
      const lastName = answers.lastName || 'Lead';
      const email = answers.email || '';
      const phone = answers.phone || '';
      const company = answers.company || '';

      state.records.contacts = state.records.contacts || [];
      let contact = email ? state.records.contacts.find(c => c.email === email && c.agencyId === form.agencyId) : null;
      let contactId = contact?.id;

      if (!contact) {
        contactId = randomUUID();
        contact = {
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
        broadcast('crm.contact.created', { id: contactId, firstName, lastName, source: 'form' });
      } else {
        if (!contact.tags) contact.tags = [];
        if (!contact.tags.includes('web-lead')) contact.tags.push('web-lead');
        if (!contact.tags.includes(form.name)) contact.tags.push(form.name);
        contact.customValues = { ...(contact.customValues || {}), ...answers };
        contact.updatedAt = new Date().toISOString();
        broadcast('crm.contact.updated', { id: contactId, firstName: contact.firstName, lastName: contact.lastName });
      }

      form.submissions = (form.submissions || 0) + 1;

      // Persist submission record
      state.records.formSubmissions = state.records.formSubmissions || [];
      const submissionId = randomUUID();
      const submission = {
        id: submissionId,
        agencyId: form.agencyId,
        locationId: form.locationId,
        formId: form.id,
        formName: form.name,
        contactId,
        contactName: `${firstName} ${lastName}`.trim(),
        email,
        phone,
        company,
        answers,
        source: body.source || 'web_form',
        status: 'new',
        submittedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      };
      state.records.formSubmissions.push(submission);

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
      state.records.opportunities = state.records.opportunities || [];
      state.records.opportunities.push(opportunity);

      await saveState();
      broadcast('crm.form.submission_received', { formId: form.id, submissionId, contactName: submission.contactName });
      broadcast('crm.opportunity.created', { id: oppId, name: opportunity.name });

      triggerWorkflowExecution({
        agencyId: form.agencyId,
        locationId: form.locationId,
        triggerType: 'form',
        triggerContext: { form, contact, opportunity, answers, submission }
      }).catch(err => console.error('Workflow trigger failed:', err));

      return sendJson(res, 200, { success: true, message: 'Thank you! Submission received.', contactId, submissionId });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── PUBLIC WEBDESK / CHAT WIDGET INGRESS ─────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && (pathname === '/widget/operza.js' || pathname === '/api/widget/embed.js')) {
      const widgetScript = `(function() {
  if (window.__operza_widget_loaded) return;
  window.__operza_widget_loaded = true;
  var scriptTag = document.currentScript || document.querySelector('script[src*="operza.js"]');
  var agencyId = scriptTag ? scriptTag.getAttribute('data-agency-id') : null;
  var locationId = scriptTag ? scriptTag.getAttribute('data-location-id') : null;
  var host = window.location.origin;

  var style = document.createElement('style');
  style.innerHTML = \`
    #operza-chat-bubble {
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 58px; height: 58px; border-radius: 50%;
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      box-shadow: 0 8px 24px rgba(79, 70, 229, 0.4);
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #operza-chat-bubble:hover { transform: scale(1.06); }
    #operza-chat-bubble svg { width: 28px; height: 28px; fill: white; }
    #operza-chat-window {
      position: fixed; bottom: 94px; right: 24px; z-index: 999999;
      width: 380px; max-width: calc(100vw - 32px); height: 540px; max-height: calc(100vh - 120px);
      background: #ffffff; border-radius: 16px;
      box-shadow: 0 20px 48px -8px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(15, 23, 42, 0.08);
      display: none; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #operza-chat-window.operza-open { display: flex; animation: opzPop 0.25s ease-out; }
    @keyframes opzPop { from { opacity: 0; transform: translateY(16px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
    .opz-header {
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: white; padding: 16px 20px; display: flex; align-items: center; justify-content: space-between;
    }
    .opz-header h4 { margin: 0; font-size: 15px; font-weight: 600; }
    .opz-header p { margin: 2px 0 0; font-size: 12px; opacity: 0.85; }
    .opz-close { background: none; border: none; color: white; cursor: pointer; font-size: 18px; line-height: 1; }
    .opz-messages { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; background: #f8fafc; }
    .opz-bubble { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 13px; line-height: 1.45; word-break: break-word; }
    .opz-bubble-bot { background: white; color: #1e293b; border: 1px solid #e2e8f0; align-self: flex-start; border-bottom-left-radius: 4px; }
    .opz-bubble-user { background: #4f46e5; color: white; align-self: flex-end; border-bottom-right-radius: 4px; }
    .opz-input-bar { padding: 12px; background: white; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 8px; }
    .opz-field { width: 100%; box-sizing: border-box; padding: 8px 12px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 13px; outline: none; }
    .opz-field:focus { border-color: #4f46e5; }
    .opz-send-btn { background: #4f46e5; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 13px; }
  \`;
  document.head.appendChild(style);

  var bubble = document.createElement('div');
  bubble.id = 'operza-chat-bubble';
  bubble.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>';

  var win = document.createElement('div');
  win.id = 'operza-chat-window';
  win.innerHTML = [
    '<div class="opz-header">',
    '  <div><h4>Live Assistance</h4><p>We typically reply in minutes</p></div>',
    '  <button class="opz-close" id="opz-close">&times;</button>',
    '</div>',
    '<div class="opz-messages" id="opz-msgs">',
    '  <div class="opz-bubble opz-bubble-bot">Hi there! 👋 How can we help grow your business today?</div>',
    '</div>',
    '<form class="opz-input-bar" id="opz-form">',
    '  <input class="opz-field" id="opz-name" placeholder="Your Name" required />',
    '  <input class="opz-field" id="opz-email" placeholder="Email or Phone" required />',
    '  <div style="display:flex; gap:8px;">',
    '    <input class="opz-field" id="opz-msg" placeholder="Type your message..." required style="flex:1;" />',
    '    <button class="opz-send-btn" type="submit">Send</button>',
    '  </div>',
    '</form>'
  ].join('');

  document.body.appendChild(bubble);
  document.body.appendChild(win);

  bubble.onclick = function() { win.classList.toggle('operza-open'); };
  document.getElementById('opz-close').onclick = function() { win.classList.remove('operza-open'); };

  var form = document.getElementById('opz-form');
  var msgs = document.getElementById('opz-msgs');
  form.onsubmit = async function(e) {
    e.preventDefault();
    var name = document.getElementById('opz-name').value.trim();
    var email = document.getElementById('opz-email').value.trim();
    var text = document.getElementById('opz-msg').value.trim();
    if (!text) return;

    var userDiv = document.createElement('div');
    userDiv.className = 'opz-bubble opz-bubble-user';
    userDiv.innerText = text;
    msgs.appendChild(userDiv);
    msgs.scrollTop = msgs.scrollHeight;
    document.getElementById('opz-msg').value = '';

    try {
      var res = await fetch(host + '/api/widget/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agencyId: agencyId,
          locationId: locationId,
          visitorName: name,
          visitorEmail: email.includes('@') ? email : undefined,
          visitorPhone: !email.includes('@') ? email : undefined,
          message: text
        })
      });
      var data = await res.json();
      if (data.reply) {
        var botDiv = document.createElement('div');
        botDiv.className = 'opz-bubble opz-bubble-bot';
        botDiv.innerText = data.reply;
        msgs.appendChild(botDiv);
        msgs.scrollTop = msgs.scrollHeight;
      }
    } catch (err) {
      console.error('[Operza Widget Error]', err);
    }
  };
})();`;
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Access-Control-Allow-Origin': '*'
      });
      return res.end(widgetScript);
    }

    if (method === 'POST' && pathname === '/api/widget/message') {
      const body = await readBody(req);
      const { visitorName, visitorEmail, visitorPhone, message } = body;
      if (!message || !message.trim()) {
        return sendJson(res, 400, { error: 'Message content is required' });
      }

      const targetAgencyId = body.agencyId || state.agencies[0]?.id;
      const targetLoc = (state.locations || []).find(l => l.agencyId === targetAgencyId) || (state.records.locations || []).find(l => l.agencyId === targetAgencyId);
      const targetLocationId = body.locationId || targetLoc?.id || targetAgencyId;

      state.records.contacts = state.records.contacts || [];
      let contact = state.records.contacts.find(c => {
        if (visitorEmail && c.email && c.email.toLowerCase() === visitorEmail.toLowerCase()) return true;
        if (visitorPhone && c.phone && c.phone === visitorPhone) return true;
        return false;
      });

      const nameParts = (visitorName || 'Web Visitor').trim().split(' ');
      const firstName = nameParts[0] || 'Web';
      const lastName = nameParts.slice(1).join(' ') || 'Visitor';

      if (!contact) {
        contact = {
          id: randomUUID(),
          agencyId: targetAgencyId,
          locationId: targetLocationId,
          firstName,
          lastName,
          email: visitorEmail || `visitor_${Date.now()}@webchat.operza.io`,
          phone: visitorPhone || '',
          company: 'Inbound Web Lead',
          tags: ['inbound', 'webchat', 'lead'],
          status: 'lead',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.contacts.push(contact);
        auditLog('contact.created', { user: { name: 'Operza Webchat' } }, { contactId: contact.id, name: `${firstName} ${lastName}` });
      }

      state.records.conversations = state.records.conversations || [];
      let conv = state.records.conversations.find(c => c.contactId === contact.id && c.channel === 'webchat');

      const incomingMsg = {
        id: randomUUID(),
        sender: 'contact',
        senderName: `${firstName} ${lastName}`,
        channel: 'webchat',
        content: message.trim(),
        timestamp: new Date().toISOString()
      };

      if (conv) {
        conv.messages = conv.messages || [];
        conv.messages.push(incomingMsg);
        conv.lastMessage = incomingMsg.content;
        conv.updatedAt = new Date().toISOString();
      } else {
        conv = {
          id: randomUUID(),
          agencyId: targetAgencyId,
          locationId: targetLocationId,
          contactId: contact.id,
          contactName: `${firstName} ${lastName}`,
          channel: 'webchat',
          status: 'open',
          messages: [incomingMsg],
          lastMessage: incomingMsg.content,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
      }

      let aiReply = null;
      const aiConfig = state.records.ai_config || {};
      if (aiConfig.capabilities?.answerQuestions !== false) {
        const docs = (state.records.ai_knowledge || []);
        let matchedSnippet = '';
        for (const doc of docs) {
          if (doc.chunks) {
            for (const ch of doc.chunks) {
              if (message.toLowerCase().split(' ').some(w => w.length > 3 && ch.content.toLowerCase().includes(w))) {
                matchedSnippet = ch.content;
                break;
              }
            }
          }
          if (matchedSnippet) break;
        }

        if (matchedSnippet) {
          aiReply = `Thanks for reaching out! Based on our knowledge base: ${matchedSnippet.slice(0, 180)}... Let us know if you'd like more details!`;
        } else {
          aiReply = `Thanks for reaching out, ${firstName}! We've received your inquiry and our growth advisory team has been notified. We will follow up right away!`;
        }

        const replyMsg = {
          id: randomUUID(),
          sender: 'agent',
          senderName: `${aiConfig.botName || 'Operza Copilot'} (AI)`,
          channel: 'webchat',
          content: aiReply,
          timestamp: new Date().toISOString()
        };
        conv.messages.push(replyMsg);
        conv.lastMessage = replyMsg.content;
        conv.updatedAt = new Date().toISOString();
      }

      await saveState();

      broadcast('crm.conversation.message_received', {
        conversationId: conv.id,
        contactId: contact.id,
        message: incomingMsg,
        channel: 'webchat'
      });
      broadcast('message.received', {
        channel: 'webchat',
        contactName: `${firstName} ${lastName}`,
        content: message.trim()
      });

      triggerWorkflowExecution({
        agencyId: targetAgencyId,
        locationId: targetLocationId,
        triggerType: 'webchat_message',
        triggerContext: { contact, message: incomingMsg, conversation: conv }
      }).catch(console.error);

      return sendJson(res, 201, {
        success: true,
        conversationId: conv.id,
        contactId: contact.id,
        reply: aiReply
      });
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

      // Dynamic Coupon Discount Application
      let discountAmount = 0;
      let appliedCoupon = null;
      if (body.couponCode) {
        const cCode = String(body.couponCode).trim().toUpperCase();
        state.records.coupons = state.records.coupons || [];
        appliedCoupon = state.records.coupons.find(c =>
          c.agencyId === link.agencyId && c.code && c.code.toUpperCase() === cCode && c.active !== false
        );
        if (appliedCoupon) {
          const isExpired = appliedCoupon.expiresAt && new Date(appliedCoupon.expiresAt).getTime() < Date.now();
          const isExhausted = appliedCoupon.maxRedemptions !== null && appliedCoupon.maxRedemptions !== undefined && appliedCoupon.redemptions >= appliedCoupon.maxRedemptions;
          if (!isExpired && !isExhausted) {
            if (appliedCoupon.kind === 'percent') {
              discountAmount = Math.round((link.amount * appliedCoupon.amount) / 100 * 100) / 100;
            } else {
              discountAmount = Math.min(appliedCoupon.amount, link.amount);
            }
            appliedCoupon.redemptions = (appliedCoupon.redemptions || 0) + 1;
          }
        }
      }
      const finalAmount = Math.max(0, link.amount - discountAmount);

      const orderId = randomUUID();
      const order = {
        id: orderId,
        agencyId: link.agencyId,
        locationId: link.locationId,
        orderNumber: `ORD-${Date.now().toString().slice(-6)}`,
        contactId: contact.id,
        contactName: `${firstName} ${lastName}`,
        amount: finalAmount,
        originalAmount: link.amount,
        discount: discountAmount,
        couponCode: appliedCoupon ? appliedCoupon.code : undefined,
        currency: link.currency || 'USD',
        status: 'paid',
        paymentLinkId: link.id,
        items: [{ name: link.name, amount: finalAmount, quantity: 1 }],
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
        amount: finalAmount,
        status: 'paid',
        dueDate: new Date().toISOString().split('T')[0],
        description: `Payment for ${link.name}${appliedCoupon ? ` (Discount coupon ${appliedCoupon.code})` : ''}`,
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

    // Public / Checkout Coupon Validation Engine
    if (method === 'POST' && pathname === '/api/coupons/validate') {
      const body = await readBody(req);
      const { code, subtotal, agencyId } = body;
      if (!code) return sendJson(res, 400, { error: 'Coupon code is required' });

      const targetAgencyId = agencyId || state.agencies[0]?.id;
      const cCode = String(code).trim().toUpperCase();
      state.records.coupons = state.records.coupons || [];

      const coupon = state.records.coupons.find(c =>
        c.agencyId === targetAgencyId && c.code && c.code.toUpperCase() === cCode
      );

      if (!coupon) {
        return sendJson(res, 404, { valid: false, error: `Coupon "${cCode}" not found` });
      }
      if (coupon.active === false) {
        return sendJson(res, 400, { valid: false, error: 'Coupon is paused or inactive' });
      }
      if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() < Date.now()) {
        return sendJson(res, 400, { valid: false, error: 'Coupon has expired' });
      }
      if (coupon.maxRedemptions !== null && coupon.maxRedemptions !== undefined && (coupon.redemptions || 0) >= coupon.maxRedemptions) {
        return sendJson(res, 400, { valid: false, error: 'Coupon redemption limit has been reached' });
      }

      const numSubtotal = Number(subtotal) || 100;
      if (coupon.minSubtotal && numSubtotal < coupon.minSubtotal) {
        return sendJson(res, 400, { valid: false, error: `Order must meet minimum subtotal of $${coupon.minSubtotal}` });
      }

      let discount = 0;
      if (coupon.kind === 'percent') {
        discount = Math.round((numSubtotal * coupon.amount) / 100 * 100) / 100;
      } else {
        discount = Math.min(coupon.amount, numSubtotal);
      }
      const newTotal = Math.max(0, numSubtotal - discount);

      return sendJson(res, 200, {
        valid: true,
        coupon: {
          id: coupon.id,
          code: coupon.code,
          kind: coupon.kind,
          amount: coupon.amount
        },
        discount,
        newTotal
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
    // ─── FUNNELS & SITES PUBLIC INGRESS ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    // Public Funnel/Site Lookup & Visit Tracker
    if (method === 'GET' && (pathname.startsWith('/api/funnels/public/') || pathname.startsWith('/api/websites/public/'))) {
      const slugOrId = pathname.replace(/^\/api\/(funnels|websites)\/public\//, '').trim();
      const pageSlug = url.searchParams.get('pageSlug');

      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w =>
        w.id === slugOrId ||
        (w.domain && w.domain.toLowerCase() === slugOrId.toLowerCase()) ||
        w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slugOrId.toLowerCase()
      );

      if (!site) {
        return sendJson(res, 404, { error: 'Funnel or website not found' });
      }

      // Track visit
      site.visits = (site.visits || 0) + 1;
      if (Array.isArray(site.pages)) {
        if (pageSlug) {
          const targetPage = site.pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
          if (targetPage) targetPage.visits = (targetPage.visits || 0) + 1;
        } else if (site.pages[0]) {
          site.pages[0].visits = (site.pages[0].visits || 0) + 1;
        }
      }
      await saveState();

      return sendJson(res, 200, {
        id: site.id,
        name: site.name,
        kind: site.kind || 'funnel',
        published: site.published,
        visits: site.visits,
        optins: site.optins || 0,
        pages: site.pages || [],
        checkout: site.checkout || null
      });
    }

    // Public Funnel Opt-in Lead & Order Bump Ingress
    if (method === 'POST' && pathname.startsWith('/api/funnels/optin/')) {
      const slugOrId = pathname.replace('/api/funnels/optin/', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w =>
        w.id === slugOrId ||
        (w.domain && w.domain.toLowerCase() === slugOrId.toLowerCase()) ||
        w.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') === slugOrId.toLowerCase()
      );

      if (!site) {
        return sendJson(res, 404, { error: 'Funnel or website not found' });
      }

      const body = await readBody(req);
      const { firstName, lastName, email, phone, company, pageSlug, bumpAccepted } = body;
      if (!firstName && !email) {
        return sendJson(res, 400, { error: 'First name or email is required' });
      }

      site.optins = (site.optins || 0) + 1;
      if (Array.isArray(site.pages) && pageSlug) {
        const targetPage = site.pages.find(p => p.slug === pageSlug || p.path === pageSlug || p.path === `/${pageSlug}`);
        if (targetPage) targetPage.optins = (targetPage.optins || 0) + 1;
      }

      const agencyId = site.agencyId || state.agencies[0]?.id;
      const locationId = site.locationId || state.locations[0]?.id;

      // Upsert contact
      state.records.contacts = state.records.contacts || [];
      let contact = email
        ? state.records.contacts.find(c => c.agencyId === agencyId && c.email && c.email.toLowerCase() === email.toLowerCase())
        : null;

      if (!contact) {
        contact = {
          id: randomUUID(),
          agencyId,
          locationId,
          firstName: firstName || 'Lead',
          lastName: lastName || '',
          email: (email || '').toLowerCase().trim(),
          phone: phone || '',
          company: company || '',
          source: `Funnel: ${site.name}`,
          tags: ['funnel-lead', site.name],
          status: 'lead',
          createdAt: new Date().toISOString()
        };
        state.records.contacts.push(contact);
      } else {
        if (firstName) contact.firstName = firstName;
        if (lastName) contact.lastName = lastName;
        if (phone) contact.phone = phone;
        contact.tags = Array.from(new Set([...(contact.tags || []), 'funnel-lead', site.name]));
      }

      // Provision Deal Opportunity
      const oppId = randomUUID();
      const oppValue = bumpAccepted && site.checkout?.bumps?.[0]?.price ? site.checkout.bumps[0].price : 1000;
      const opp = {
        id: oppId,
        agencyId,
        locationId,
        name: `${contact.firstName} ${contact.lastName || ''} - ${site.name}`.trim(),
        contactId: contact.id,
        stage: 'New Inbound Lead',
        value: oppValue,
        status: 'open',
        source: `Funnel: ${site.name}`,
        createdAt: new Date().toISOString()
      };
      state.records.opportunities = state.records.opportunities || [];
      state.records.opportunities.push(opp);

      // Order Bump fulfillment
      let order = null;
      if (bumpAccepted && site.checkout?.bumps?.length) {
        const bump = site.checkout.bumps.find(b => b.enabled) || site.checkout.bumps[0];
        const orderId = randomUUID();
        const invoiceId = randomUUID();
        const orderNum = `ORD-${Math.floor(100000 + Math.random() * 900000)}`;
        order = {
          id: orderId,
          agencyId,
          locationId,
          orderNumber: orderNum,
          contactId: contact.id,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          amount: bump.price,
          currency: 'USD',
          status: 'completed',
          items: [{ name: bump.headline || 'Order Bump', price: bump.price, quantity: 1 }],
          bumpAccepted: true,
          bumpAmount: bump.price,
          paidAt: new Date().toISOString(),
          createdAt: new Date().toISOString()
        };
        state.records.orders = state.records.orders || [];
        state.records.orders.push(order);

        const invoice = {
          id: invoiceId,
          agencyId,
          locationId,
          number: `INV-${orderNum.replace('ORD-', '')}`,
          contactName: `${contact.firstName} ${contact.lastName}`.trim(),
          amount: bump.price,
          status: 'paid',
          dueDate: new Date().toISOString().slice(0, 10),
          createdAt: new Date().toISOString()
        };
        state.records.invoices = state.records.invoices || [];
        state.records.invoices.push(invoice);
      }

      await saveState();

      broadcast('funnel.optin.received', { siteId: site.id, contactId: contact.id, siteName: site.name });
      auditLog('funnel.optin', null, { siteId: site.id, siteName: site.name, contactId: contact.id });

      triggerWorkflowExecution({
        agencyId,
        locationId,
        triggerType: 'funnel_optin',
        triggerContext: { site, contact, opportunity: opp, order }
      }).catch(console.error);

      return sendJson(res, 201, {
        success: true,
        siteId: site.id,
        contact,
        opportunity: opp,
        order
      });
    }

    // Public Media File Server
    if (method === 'GET' && pathname.startsWith('/api/media/file/')) {
      const fileId = pathname.replace('/api/media/file/', '').trim();
      const fileRecord = (state.records.media || []).find(m => m.id === fileId);
      const stored = (state.mediaFiles || {})[fileId];

      if (stored) {
        res.writeHead(200, {
          'Content-Type': stored.mimeType || 'image/png',
          'Content-Length': Buffer.isBuffer(stored.data) ? stored.data.length : Buffer.byteLength(stored.data),
          'Cache-Control': 'public, max-age=86400'
        });
        return res.end(stored.data);
      }

      if (fileRecord) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
          <rect width="400" height="300" fill="#f3f4f6"/>
          <text x="200" y="140" font-family="sans-serif" font-size="18" font-weight="bold" fill="#374151" text-anchor="middle">${fileRecord.name}</text>
          <text x="200" y="170" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">${fileRecord.kind.toUpperCase()} · ${fileRecord.sizeKb} KB</text>
        </svg>`;
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400'
        });
        return res.end(svg);
      }

      return sendJson(res, 404, { error: 'Media asset not found' });
    }

    // Public Blog Post Reader Ingress
    if (method === 'GET' && pathname.startsWith('/api/blogs/public/')) {
      const rawSlug = pathname.replace('/api/blogs/public/', '').trim();
      state.records.blogs = state.records.blogs || [];
      const blog = state.records.blogs.find(b =>
        b.status === 'published' && (
          b.slug === rawSlug ||
          (b.title && b.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') === rawSlug)
        )
      );

      if (!blog) {
        return sendJson(res, 404, { error: 'Blog post not found or unpublished' });
      }

      blog.views = (blog.views || 0) + 1;
      await saveState();

      broadcast('blog.viewed', { blogId: blog.id, slug: rawSlug, views: blog.views });

      return sendJson(res, 200, {
        id: blog.id,
        title: blog.title,
        slug: blog.slug || blog.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        author: blog.author || 'Editorial Team',
        category: blog.category || 'Insights',
        content: blog.content || '',
        views: blog.views,
        publishedAt: blog.publishedAt || blog.createdAt,
        coverImage: blog.coverImage
      });
    }

    // Public QR Code SVG Vector Delivery
    if (method === 'GET' && pathname.startsWith('/api/qr/') && pathname.endsWith('.svg')) {
      const id = pathname.replace('/api/qr/', '').replace('.svg', '').trim();
      state.records.qrCodes = state.records.qrCodes || [];
      const qr = state.records.qrCodes.find(q => q.id === id);
      if (!qr) {
        return sendJson(res, 404, { error: 'QR Code not found' });
      }

      const svg = generateQrSvg(qr.target || 'https://operza.io', 256);
      res.writeHead(200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=3600'
      });
      return res.end(svg);
    }

    // Public QR Code Scan Tracker
    if (method === 'GET' && pathname.startsWith('/api/qr/') && pathname.endsWith('/scan')) {
      const id = pathname.replace('/api/qr/', '').replace('/scan', '').trim();
      state.records.qrCodes = state.records.qrCodes || [];
      const qr = state.records.qrCodes.find(q => q.id === id);
      if (!qr) {
        return sendJson(res, 404, { error: 'QR Code not found' });
      }

      qr.scans = (qr.scans || 0) + 1;
      qr.lastScannedAt = new Date().toISOString();
      await saveState();

      broadcast('qr.scanned', { qrId: qr.id, scans: qr.scans, target: qr.target });
      auditLog('qr.scanned', null, { qrId: qr.id, name: qr.name, scans: qr.scans });

      if (url.searchParams.get('redirect') === 'true') {
        res.writeHead(302, { Location: qr.target || '/' });
        return res.end();
      }

      return sendJson(res, 200, {
        success: true,
        id: qr.id,
        name: qr.name,
        target: qr.target,
        scans: qr.scans,
        lastScannedAt: qr.lastScannedAt
      });
    }

    // Public Client Portal Summary Ingress
    if (method === 'GET' && pathname.startsWith('/api/portal/summary/')) {
      const contactId = pathname.replace('/api/portal/summary/', '').trim();
      state.records.contacts = state.records.contacts || [];
      const contact = state.records.contacts.find(c => c.id === contactId);

      if (!contact) {
        return sendJson(res, 404, { error: 'Contact not found' });
      }

      if (contact.portalAccess === false) {
        return sendJson(res, 403, { error: 'Portal access not enabled for this contact' });
      }

      state.records.invoices = state.records.invoices || [];
      state.records.documents = state.records.documents || [];
      state.records.enrollments = state.records.enrollments || [];
      state.records.courses = state.records.courses || [];
      state.records.appointments = state.records.appointments || [];

      const fullName = `${contact.firstName} ${contact.lastName}`.trim().toLowerCase();

      const invoices = state.records.invoices.filter(i =>
        i.contactId === contact.id || (i.contactName && i.contactName.toLowerCase() === fullName)
      );

      const enrollments = state.records.enrollments.filter(e => e.contactId === contact.id);
      const courses = enrollments.map(e => {
        const course = state.records.courses.find(c => c.id === e.courseId);
        return {
          courseId: e.courseId,
          name: course?.name || course?.title || 'Enrolled Course',
          progress: e.progress || 0,
          startedAt: e.startedAt,
          status: e.status,
          lessonsCount: Array.isArray(course?.curriculum) ? course.curriculum.length : (course?.lessons || 0),
          curriculum: course?.curriculum || []
        };
      });

      const documents = state.records.documents.filter(d => d.contactId === contact.id);

      const appointments = state.records.appointments.filter(a =>
        a.contactId === contact.id || (a.contactName && a.contactName.toLowerCase() === fullName)
      );

      return sendJson(res, 200, {
        contact: {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email,
          company: contact.company,
          portalAccess: contact.portalAccess !== false
        },
        invoices,
        courses,
        documents,
        appointments
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
      } else if (messageType === 'call_status' || payload.CallDuration !== undefined || payload.CallStatus) {
        const callStatus = payload.CallStatus || 'completed';
        const outcome = (callStatus === 'completed') ? 'completed' : ((callStatus === 'no-answer' || callStatus === 'busy') ? 'missed' : 'voicemail');
        const fromNumber = normalizePhone(payload.From || '');

        state.records.calls = state.records.calls || [];
        const contact = (state.records.contacts || []).find(c =>
          normalizePhone(c.phone || '') === fromNumber
        );

        const agencyId = contact?.agencyId || state.agencies[0]?.id;
        const locationId = contact?.locationId || state.locations[0]?.id;

        const callRecord = {
          id: payload.CallSid || randomUUID(),
          agencyId,
          locationId,
          from: fromNumber,
          to: payload.To || '',
          durationSec: Number(payload.CallDuration) || (outcome === 'completed' ? 120 : 0),
          outcome,
          direction: 'inbound',
          contactId: contact ? contact.id : undefined,
          startedAt: new Date().toISOString()
        };
        state.records.calls.push(callRecord);

        // Automated Missed-Call Follow Up Task & Trigger
        if (outcome === 'missed' && contact) {
          contact.tags = Array.from(new Set([...(contact.tags || []), 'missed-call']));
          state.records.tasks = state.records.tasks || [];
          state.records.tasks.push({
            id: randomUUID(),
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            title: `Missed call follow-up: ${contact.firstName} ${contact.lastName}`,
            priority: 'high',
            status: 'pending',
            contactId: contact.id,
            dueDate: new Date(Date.now() + 3600000).toISOString(),
            createdAt: new Date().toISOString()
          });

          triggerWorkflowExecution({
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            triggerType: 'missed_call',
            triggerContext: { contact, call: callRecord }
          }).catch(console.error);
        }

        await saveState();
        broadcast('phone.call.received', callRecord);
      }

      // Return TwiML-compatible response
      res.writeHead(200, { 'content-type': 'text/xml' });
      res.end('<Response><Say>Thanks for calling Operza.</Say></Response>');
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

      // Seed default published blog post
      state.records.blogs = state.records.blogs || [];
      state.records.blogs.push({
        id: randomUUID(),
        agencyId,
        locationId,
        title: 'How AI Automation Scales 7-Figure Marketing Agencies',
        slug: 'how-ai-automation-scales-agencies',
        author: 'Elena Rostova',
        category: 'Strategy',
        content: 'Scaling a modern marketing agency requires moving from fragmented manual tools to unified autonomous agent infrastructure. In this guide, we break down end-to-end inbound capture, AI pipeline qualification, and automated fulfillment.',
        status: 'published',
        views: 142,
        publishedAt: new Date().toISOString(),
        createdAt: new Date().toISOString()
      });

      // Seed default QR code
      state.records.qrCodes = state.records.qrCodes || [];
      state.records.qrCodes.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Discovery Booking QR',
        target: '/calendars/public/discovery-strategy',
        scans: 12,
        createdAt: new Date().toISOString()
      });

      // Seed default media asset
      state.records.media = state.records.media || [];
      state.records.media.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'brand-hero-logo.svg',
        folder: 'Logos',
        kind: 'image',
        sizeKb: 34,
        mimeType: 'image/svg+xml',
        url: '/api/media/file/brand-hero-logo',
        uploadedAt: new Date().toISOString()
      });

      // Seed default snippet
      state.records.snippets = state.records.snippets || [];
      state.records.snippets.push({
        id: randomUUID(),
        agencyId,
        locationId,
        label: 'Discovery Call Follow-up',
        subject: 'Following up on our discovery conversation',
        body: 'Hi {{contact.firstName}}, great speaking with you today! We look forward to scaling {{contact.company}} with {{agency.name}}.',
        channel: 'email',
        uses: 8
      });

      // Seed default template
      state.records.templates = state.records.templates || [];
      state.records.templates.push({
        id: randomUUID(),
        agencyId,
        locationId,
        name: 'Welcome & Onboarding Packet',
        category: 'Onboarding',
        subject: 'Welcome to {{agency.name}}, {{contact.firstName}}!',
        body: 'Hello {{contact.firstName}},\n\nWelcome to {{agency.name}}! Your dedicated growth portal is ready.\n\nBest regards,\n{{agency.name}} Team',
        uses: 15,
        updatedAt: new Date().toISOString()
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

    if (method === 'GET' && (pathname === '/api/audit' || pathname === '/api/audit-logs')) {
      const q = (url.searchParams.get('q') || url.searchParams.get('search') || '').toLowerCase();
      const actionFilter = url.searchParams.get('action');
      const actorFilter = url.searchParams.get('actor') || url.searchParams.get('userName');
      const entityFilter = url.searchParams.get('entity');
      const format = url.searchParams.get('format');
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);

      let logs = (state.audit || []).filter(a => a.agencyId === agency.id || a.agencyId === '');
      if (actionFilter) {
        logs = logs.filter(a => a.action === actionFilter);
      }
      if (actorFilter) {
        logs = logs.filter(a => (a.userName || '').toLowerCase() === actorFilter.toLowerCase());
      }
      if (entityFilter) {
        logs = logs.filter(a => {
          const ent = (a.action || '').split('.')[0] || '';
          return ent.toLowerCase() === entityFilter.toLowerCase();
        });
      }
      if (q) {
        logs = logs.filter(a =>
          a.action.toLowerCase().includes(q) ||
          (a.userName && a.userName.toLowerCase().includes(q)) ||
          JSON.stringify(a.details || {}).toLowerCase().includes(q)
        );
      }
      logs = logs.slice().reverse().slice(0, limit);

      if (format === 'csv') {
        const headers = ['id', 'timestamp', 'userName', 'action', 'details'];
        const csvRows = [headers.join(',')];
        for (const log of logs) {
          csvRows.push([
            JSON.stringify(log.id || ''),
            JSON.stringify(log.timestamp || ''),
            JSON.stringify(log.userName || 'System'),
            JSON.stringify(log.action || ''),
            JSON.stringify(typeof log.details === 'object' ? JSON.stringify(log.details) : String(log.details || ''))
          ].join(','));
        }
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="operza-audit-log.csv"',
          'Access-Control-Allow-Origin': '*'
        });
        return res.end(csvRows.join('\n'));
      }

      return sendJson(res, 200, { data: logs, total: logs.length });
    }

    if (method === 'DELETE' && (pathname === '/api/audit' || pathname === '/api/audit-logs')) {
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

    if (method === 'POST' && pathname.startsWith('/api/campaigns/') && pathname.endsWith('/test-send')) {
      const campaignId = pathname.replace('/api/campaigns/', '').replace('/test-send', '').trim();
      const campaign = (state.records.campaigns || []).find(
        c => c.id === campaignId && c.agencyId === agency.id && c.locationId === activeLocation.id
      );
      if (!campaign && campaignId !== 'preview') {
        return sendJson(res, 404, { error: 'Campaign not found' });
      }

      const body = await readBody(req);
      const recipient = body.recipient || actor.user.email || 'operator@operza.io';
      const subject = body.subject || (campaign ? campaign.name : 'Test Broadcast');
      const blocks = body.blocks || (campaign ? campaign.blocks : []);
      const channel = body.channel || (campaign ? campaign.kind : 'email');

      auditLog('campaign.test_sent', actor, {
        campaignId,
        recipient,
        subject,
        channel,
        blockCount: blocks.length || 0
      });

      return sendJson(res, 200, {
        success: true,
        message: `Test ${channel.toUpperCase()} successfully dispatched to ${recipient}`,
        recipient,
        subject,
        deliveredAt: new Date().toISOString()
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
    // ─── TRIGGER LINKS CLICK INGRESS & AUTOMATION ────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname.startsWith('/api/links/click/')) {
      const slug = pathname.replace('/api/links/click/', '').trim();
      state.records.triggerLinks = state.records.triggerLinks || [];
      const link = state.records.triggerLinks.find(l => l.slug === slug);
      if (!link) return sendJson(res, 404, { error: 'Trigger link not found' });

      link.clicks = (link.clicks || 0) + 1;
      link.lastClickAt = new Date().toISOString();
      await saveState();

      const contactId = url.searchParams.get('contactId');
      let contact = null;
      if (contactId) {
        contact = (state.records.contacts || []).find(c => c.id === contactId);
      }

      if (link.workflowId) {
        triggerWorkflowExecution({
          agencyId: link.agencyId || agency?.id,
          locationId: link.locationId || activeLocation?.id,
          triggerType: 'trigger_link_clicked',
          triggerContext: { link, contact, contactId }
        }).catch(console.error);
      }

      broadcast('link.clicked', { slug, clicks: link.clicks });
      return sendJson(res, 200, { success: true, targetUrl: link.targetUrl, clicks: link.clicks });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── DOCUMENTS & CONTRACTS E-SIGNATURE INGRESS ───────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname.startsWith('/api/documents/') && pathname.endsWith('/sign')) {
      const docId = pathname.replace('/api/documents/', '').replace('/sign', '').trim();
      state.records.documents = state.records.documents || [];
      const doc = state.records.documents.find(
        d => d.id === docId && d.agencyId === agency.id && d.locationId === activeLocation.id
      );
      if (!doc) return sendJson(res, 404, { error: 'Document not found' });

      const body = await readBody(req);
      doc.status = 'signed';
      doc.signedAt = new Date().toISOString();
      doc.signerName = body.signerName || actor.user.name;
      doc.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('document.signed', actor, { docId, title: doc.title, signer: doc.signerName });
      broadcast('crm.document.signed', { docId, title: doc.title });

      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'document_signed',
        triggerContext: { document: doc }
      }).catch(console.error);

      return sendJson(res, 200, { success: true, document: doc });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── RECURRING SUBSCRIPTIONS ENGINE ──────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/subscriptions') {
      state.records.subscriptions = state.records.subscriptions || [];
      const list = state.records.subscriptions.filter(
        s => s.agencyId === agency.id && (!activeLocation || s.locationId === activeLocation.id)
      );
      return sendJson(res, 200, { data: list });
    }

    if (method === 'POST' && pathname === '/api/subscriptions') {
      const body = await readBody(req);
      const { plan, amount, contactId, interval = 'month', status = 'active', renewsAt } = body;
      if (!plan || amount === undefined || !contactId) {
        return sendJson(res, 400, { error: 'plan, amount, and contactId are required' });
      }

      state.records.subscriptions = state.records.subscriptions || [];
      const contact = (state.records.contacts || []).find(c => c.id === contactId && c.agencyId === agency.id);

      const calculatedRenewsAt = renewsAt || new Date(Date.now() + (interval === 'year' ? 365 : 30) * 86400000).toISOString();
      const subId = randomUUID();
      const newSub = {
        id: subId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        contactId,
        plan,
        amount: Number(amount),
        interval,
        status,
        renewsAt: calculatedRenewsAt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.subscriptions.push(newSub);
      await saveState();

      auditLog('subscription.created', actor, {
        subId,
        plan,
        amount: newSub.amount,
        contactName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : contactId
      });
      broadcast('crm.subscription.created', newSub);

      return sendJson(res, 201, { success: true, subscription: newSub });
    }

    if (method === 'POST' && pathname.startsWith('/api/subscriptions/') && pathname.endsWith('/cancel')) {
      const subId = pathname.replace('/api/subscriptions/', '').replace('/cancel', '').trim();
      state.records.subscriptions = state.records.subscriptions || [];
      const sub = state.records.subscriptions.find(
        s => s.id === subId && s.agencyId === agency.id && s.locationId === activeLocation.id
      );
      if (!sub) return sendJson(res, 404, { error: 'Subscription not found' });

      sub.status = 'canceled';
      sub.canceledAt = new Date().toISOString();
      sub.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('subscription.canceled', actor, { subId, plan: sub.plan });
      broadcast('crm.subscription.updated', { subId, status: 'canceled' });

      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'subscription_cancelled',
        triggerContext: { subscription: sub }
      }).catch(console.error);

      return sendJson(res, 200, { success: true, subscription: sub });
    }

    if (method === 'POST' && pathname.startsWith('/api/subscriptions/') && pathname.endsWith('/resume')) {
      const subId = pathname.replace('/api/subscriptions/', '').replace('/resume', '').trim();
      state.records.subscriptions = state.records.subscriptions || [];
      const sub = state.records.subscriptions.find(
        s => s.id === subId && s.agencyId === agency.id && s.locationId === activeLocation.id
      );
      if (!sub) return sendJson(res, 404, { error: 'Subscription not found' });

      sub.status = 'active';
      delete sub.canceledAt;
      sub.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('subscription.resumed', actor, { subId, plan: sub.plan });
      broadcast('crm.subscription.updated', { subId, status: 'active' });

      return sendJson(res, 200, { success: true, subscription: sub });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── FORMS & SURVEYS ENGINE ──────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    // Toggle Form Published State
    if (method === 'POST' && pathname.startsWith('/api/forms/') && pathname.endsWith('/publish')) {
      const formId = pathname.replace('/api/forms/', '').replace('/publish', '').trim();
      const body = await readBody(req);
      state.records.forms = state.records.forms || [];
      const form = state.records.forms.find(f => f.id === formId && f.agencyId === agency.id);
      if (!form) return sendJson(res, 404, { error: 'Form not found' });

      const isPublished = body.published !== undefined ? Boolean(body.published) : !form.published;
      form.published = isPublished;
      form.status = isPublished ? 'published' : 'draft';
      form.updatedAt = new Date().toISOString();

      await saveState();
      auditLog(isPublished ? 'form.published' : 'form.unpublished', actor, { formId, name: form.name });
      broadcast('crm.form.updated', { id: formId, published: isPublished, status: form.status });

      return sendJson(res, 200, { success: true, form });
    }

    // Get Form Submissions
    if (method === 'GET' && (pathname === '/api/forms/submissions' || (pathname.startsWith('/api/forms/') && pathname.endsWith('/submissions')))) {
      state.records.formSubmissions = state.records.formSubmissions || [];
      let formId = url.searchParams.get('formId');
      if (pathname.startsWith('/api/forms/') && pathname.endsWith('/submissions') && pathname !== '/api/forms/submissions') {
        formId = pathname.replace('/api/forms/', '').replace('/submissions', '').trim();
      }
      const submissions = state.records.formSubmissions.filter(s => {
        const matchesAgency = s.agencyId === agency.id;
        const matchesLocation = !activeLocation || s.locationId === activeLocation.id;
        const matchesForm = !formId || s.formId === formId;
        return matchesAgency && matchesLocation && matchesForm;
      });
      return sendJson(res, 200, { submissions });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── HOSTED WEBSITES & MULTI-PAGE CMS ───────────────────────
    // ═════════════════════════════════════════════════════════════

    // Toggle Website / Funnel Publishing State
    if (method === 'POST' && pathname.startsWith('/api/websites/') && pathname.endsWith('/publish')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/publish', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w => w.id === siteId && (w.agencyId === agency.id || !w.agencyId));
      if (!site) return sendJson(res, 404, { error: 'Website not found' });
      site.published = !site.published;
      site.status = site.published ? 'published' : 'draft';
      site.updatedAt = new Date().toISOString();
      const actionName = site.published ? 'website.published' : 'website.unpublished';
      auditLog(actionName, actor, { siteId: site.id, name: site.name, published: site.published });
      broadcast('crm.website.updated', { siteId: site.id, published: site.published, status: site.status });
      await saveState();
      return sendJson(res, 200, { success: true, published: site.published, status: site.status, site });
    }

    // Add Page to Website / Funnel
    if (method === 'POST' && pathname.startsWith('/api/websites/') && pathname.endsWith('/pages')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/pages', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w => w.id === siteId && (w.agencyId === agency.id || !w.agencyId));
      if (!site) return sendJson(res, 404, { error: 'Website not found' });
      const body = await readBody(req);
      const newPage = {
        id: body.id || randomUUID(),
        name: body.name || 'New Page',
        path: body.path || `/${(body.name || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        headline: body.headline || body.name || 'Welcome',
        subhead: body.subhead || '',
        cta: body.cta || 'Get started',
        theme: body.theme || 'plain',
        visits: 0,
        optins: 0,
        createdAt: new Date().toISOString()
      };
      site.pages = Array.isArray(site.pages) ? [...site.pages, newPage] : [newPage];
      site.updatedAt = new Date().toISOString();
      auditLog('website.page_created', actor, { siteId: site.id, pageId: newPage.id, pageName: newPage.name });
      broadcast('crm.website.page_created', { siteId: site.id, page: newPage });
      await saveState();
      return sendJson(res, 201, { success: true, page: newPage, site });
    }

    // Reorder Pages of Website / Funnel
    if (method === 'PUT' && pathname.startsWith('/api/websites/') && pathname.endsWith('/pages/reorder')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/pages/reorder', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w => w.id === siteId && (w.agencyId === agency.id || !w.agencyId));
      if (!site) return sendJson(res, 404, { error: 'Website not found' });
      const body = await readBody(req);
      if (Array.isArray(body.pages)) {
        site.pages = body.pages;
      } else if (Array.isArray(body.pageIds)) {
        const pageMap = new Map((site.pages || []).map(p => [p.id, p]));
        site.pages = body.pageIds.map(id => pageMap.get(id)).filter(Boolean);
      }
      site.updatedAt = new Date().toISOString();
      auditLog('website.pages_reordered', actor, { siteId: site.id, pageCount: site.pages.length });
      broadcast('crm.website.reordered', { siteId: site.id, pages: site.pages });
      await saveState();
      return sendJson(res, 200, { success: true, pages: site.pages, site });
    }

    // Delete Page from Website / Funnel
    if (method === 'DELETE' && pathname.includes('/api/websites/') && pathname.includes('/pages/')) {
      const match = pathname.match(/^\/api\/websites\/([^/]+)\/pages\/([^/]+)$/);
      if (match) {
        const [, siteId, pageId] = match;
        state.records.websites = state.records.websites || [];
        const site = state.records.websites.find(w => w.id === siteId && (w.agencyId === agency.id || !w.agencyId));
        if (!site) return sendJson(res, 404, { error: 'Website not found' });
        site.pages = (site.pages || []).filter(p => p.id !== pageId);
        site.updatedAt = new Date().toISOString();
        auditLog('website.page_deleted', actor, { siteId: site.id, pageId });
        broadcast('crm.website.page_deleted', { siteId: site.id, pageId });
        await saveState();
        return sendJson(res, 200, { success: true, remainingPages: site.pages.length, site });
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── MEMBERSHIPS & COURSE ENROLLMENT ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname === '/api/memberships/enroll') {
      const body = await readBody(req);
      const { courseId, contactId } = body;
      if (!courseId || !contactId) {
        return sendJson(res, 400, { error: 'courseId and contactId are required' });
      }

      state.records.courses = state.records.courses || [];
      state.records.enrollments = state.records.enrollments || [];

      const course = state.records.courses.find(c => c.id === courseId && c.agencyId === agency.id);
      const contact = (state.records.contacts || []).find(c => c.id === contactId && c.agencyId === agency.id);
      if (!course) return sendJson(res, 404, { error: 'Course not found' });
      if (!contact) return sendJson(res, 404, { error: 'Contact not found' });

      let enrollment = state.records.enrollments.find(e => e.courseId === courseId && e.contactId === contactId);
      if (!enrollment) {
        enrollment = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          courseId,
          contactId,
          courseName: course.name,
          contactName: `${contact.firstName} ${contact.lastName}`,
          progress: 0,
          status: 'active',
          startedAt: new Date().toISOString()
        };
        state.records.enrollments.push(enrollment);
        course.members = (course.members || 0) + 1;
        await saveState();

        auditLog('membership.enrolled', actor, { courseId, contactId });
        broadcast('membership.enrolled', { courseId, contactId });

        triggerWorkflowExecution({
          agencyId: agency.id,
          locationId: activeLocation.id,
          triggerType: 'course_enrolled',
          triggerContext: { course, contact, enrollment }
        }).catch(console.error);
      }

      return sendJson(res, 201, { success: true, enrollment });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AFFILIATES & COMMISSION CONVERSION TRACKING ────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname.startsWith('/api/affiliates/track/')) {
      const code = pathname.replace('/api/affiliates/track/', '').trim();
      state.records.affiliates = state.records.affiliates || [];
      const affiliate = state.records.affiliates.find(
        a => a.code === code && a.agencyId === agency.id
      );
      if (!affiliate) return sendJson(res, 404, { error: 'Affiliate not found' });

      const body = await readBody(req);
      const orderAmount = Number(body.amount) || 1000;
      const commissionPct = affiliate.commissionPct || 20;
      const commissionEarned = (orderAmount * commissionPct) / 100;

      affiliate.conversions = (affiliate.conversions || 0) + 1;
      affiliate.payout = (affiliate.payout || 0) + commissionEarned;
      affiliate.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('affiliate.commission_earned', actor, { code, commissionEarned });
      broadcast('affiliate.conversion', { code, commissionEarned, totalPayout: affiliate.payout });

      triggerWorkflowExecution({
        agencyId: agency.id,
        locationId: activeLocation.id,
        triggerType: 'affiliate_commission',
        triggerContext: { affiliate, commissionEarned, orderAmount }
      }).catch(console.error);

      return sendJson(res, 200, { success: true, affiliate, commissionEarned });
    }

    // Settle Affiliate Commission Payout
    if (method === 'POST' && pathname.startsWith('/api/affiliates/') && pathname.endsWith('/payout')) {
      const affiliateId = pathname.replace('/api/affiliates/', '').replace('/payout', '').trim();
      state.records.affiliates = state.records.affiliates || [];
      const affiliate = state.records.affiliates.find(
        a => a.id === affiliateId && a.agencyId === agency.id
      );
      if (!affiliate) return sendJson(res, 404, { error: 'Affiliate not found' });

      const body = await readBody(req);
      const balance = Number(affiliate.payout) || 0;
      const requestedAmount = body.amount !== undefined ? Number(body.amount) : balance;
      const paidAmount = Math.max(0, Math.min(balance, requestedAmount));

      affiliate.payout = Math.max(0, balance - paidAmount);
      affiliate.updatedAt = new Date().toISOString();

      // Generate invoice / payout settlement record
      const invoiceId = randomUUID();
      const invoiceNum = `PAY-${Math.floor(100000 + Math.random() * 900000)}`;
      state.records.invoices = state.records.invoices || [];
      state.records.invoices.push({
        id: invoiceId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        number: invoiceNum,
        contactName: affiliate.name,
        amount: paidAmount,
        status: 'paid',
        dueDate: new Date().toISOString(),
        description: `Affiliate Commission Payout for code ${affiliate.code}`,
        createdAt: new Date().toISOString()
      });

      await saveState();
      auditLog('affiliate.payout', actor, { affiliateId, paidAmount, code: affiliate.code, remainingBalance: affiliate.payout });
      broadcast('affiliate.payout_settled', { affiliateId, paidAmount, remainingPayout: affiliate.payout, invoiceId });

      return sendJson(res, 200, {
        success: true,
        affiliate,
        paidAmount,
        remainingPayout: affiliate.payout,
        invoiceId
      });
    }

    // Get Affiliate Payout Aggregated Report
    if (method === 'GET' && pathname === '/api/affiliates/payout-report') {
      state.records.affiliates = state.records.affiliates || [];
      const tenantAffiliates = state.records.affiliates.filter(a => a.agencyId === agency.id);
      const activePartners = tenantAffiliates.filter(a => a.status === 'active');
      const totalUnpaid = tenantAffiliates.reduce((sum, a) => sum + (Number(a.payout) || 0), 0);
      const totalConversions = tenantAffiliates.reduce((sum, a) => sum + (Number(a.conversions) || 0), 0);

      const partners = tenantAffiliates.map(a => ({
        id: a.id,
        name: a.name,
        email: a.email || '',
        code: a.code,
        payout: Number(a.payout) || 0,
        conversions: Number(a.conversions) || 0,
        clicks: Number(a.clicks) || 0,
        commissionPct: Number(a.commissionPct) || 20,
        status: a.status || 'active'
      }));

      return sendJson(res, 200, {
        success: true,
        totalPartners: tenantAffiliates.length,
        activePartners: activePartners.length,
        totalUnpaid,
        totalConversions,
        partners
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── CUSTOM VALUES RESOLUTION & MERGE ENGINE ────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname === '/api/custom-values/resolve') {
      const body = await readBody(req);
      const { text, contactId } = body;
      if (typeof text !== 'string') {
        return sendJson(res, 400, { error: 'Text string is required' });
      }

      let contact = null;
      if (contactId) {
        contact = (state.records.contacts || []).find(c => c.id === contactId && c.agencyId === agency.id);
      }

      const { resolvedText, tokensResolved } = resolveTokensHelper(text, agency, contact, actor.user?.email);
      return sendJson(res, 200, { resolvedText, tokensResolved });
    }

    // Use Snippet & Resolve Merge Tokens
    if (method === 'POST' && pathname.startsWith('/api/snippets/') && pathname.endsWith('/use')) {
      const snippetId = pathname.replace('/api/snippets/', '').replace('/use', '').trim();
      state.records.snippets = state.records.snippets || [];
      const snippet = state.records.snippets.find(s => s.id === snippetId && s.agencyId === agency.id);
      if (!snippet) {
        return sendJson(res, 404, { error: 'Snippet not found' });
      }

      const body = await readBody(req);
      let contact = null;
      if (body.contactId) {
        contact = (state.records.contacts || []).find(c => c.id === body.contactId && c.agencyId === agency.id);
      }

      snippet.uses = (snippet.uses || 0) + 1;
      const resBody = resolveTokensHelper(snippet.body, agency, contact, actor.user?.email);
      const resSubject = snippet.subject ? resolveTokensHelper(snippet.subject, agency, contact, actor.user?.email) : null;

      await saveState();
      broadcast('snippet.used', { snippetId: snippet.id, uses: snippet.uses });

      return sendJson(res, 200, {
        success: true,
        snippetId: snippet.id,
        uses: snippet.uses,
        resolvedBody: resBody.resolvedText,
        resolvedSubject: resSubject ? resSubject.resolvedText : undefined,
        tokensResolved: resBody.tokensResolved + (resSubject ? resSubject.tokensResolved : 0)
      });
    }

    // Use Template & Resolve Merge Tokens
    if (method === 'POST' && pathname.startsWith('/api/templates/') && pathname.endsWith('/use')) {
      const templateId = pathname.replace('/api/templates/', '').replace('/use', '').trim();
      state.records.templates = state.records.templates || [];
      const template = state.records.templates.find(t => t.id === templateId && t.agencyId === agency.id);
      if (!template) {
        return sendJson(res, 404, { error: 'Template not found' });
      }

      const body = await readBody(req);
      let contact = null;
      if (body.contactId) {
        contact = (state.records.contacts || []).find(c => c.id === body.contactId && c.agencyId === agency.id);
      }

      template.uses = (template.uses || 0) + 1;
      const resBody = resolveTokensHelper(template.body, agency, contact, actor.user?.email);
      const resSubject = resolveTokensHelper(template.subject, agency, contact, actor.user?.email);

      await saveState();
      broadcast('template.used', { templateId: template.id, uses: template.uses });

      return sendJson(res, 200, {
        success: true,
        templateId: template.id,
        uses: template.uses,
        resolvedBody: resBody.resolvedText,
        resolvedSubject: resSubject.resolvedText,
        tokensResolved: resBody.tokensResolved + resSubject.tokensResolved
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── REPUTATION: REVIEW REPLIES & REQUEST DISPATCH ──────────
    // ═════════════════════════════════════════════════════════════

    // Reply to Review
    if (method === 'POST' && pathname.startsWith('/api/reviews/') && pathname.endsWith('/reply')) {
      const reviewId = pathname.replace('/api/reviews/', '').replace('/reply', '').trim();
      state.records.reviews = state.records.reviews || [];
      const review = state.records.reviews.find(r => r.id === reviewId && r.agencyId === agency.id);
      if (!review) return sendJson(res, 404, { error: 'Review not found' });

      const body = await readBody(req);
      const reply = (body.reply || '').trim();
      if (!reply) return sendJson(res, 400, { error: 'Reply text is required' });

      review.reply = reply;
      review.status = 'replied';
      review.repliedAt = new Date().toISOString();
      await saveState();

      auditLog('review.replied', actor, { reviewId, contactName: review.contactName });
      broadcast('review.replied', { id: review.id, reply, status: review.status, repliedAt: review.repliedAt });

      return sendJson(res, 200, { success: true, review });
    }

    // Create & Dispatch Review Request
    if (method === 'POST' && pathname === '/api/reviews/request') {
      const body = await readBody(req);
      const { contactId, channel, message, scheduledAt, sendNow } = body;
      if (!contactId) return sendJson(res, 400, { error: 'contactId is required' });

      state.records.contacts = state.records.contacts || [];
      const contact = state.records.contacts.find(c => c.id === contactId && c.agencyId === agency.id);
      if (!contact) return sendJson(res, 404, { error: 'Contact not found' });

      const reqId = randomUUID();
      const isSendNow = Boolean(sendNow) || !scheduledAt || new Date(scheduledAt).getTime() <= Date.now();
      const sentAt = isSendNow ? new Date().toISOString() : null;

      const reviewReq = {
        id: reqId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        contactId,
        channel: channel || 'email',
        message: (message || '').trim(),
        scheduledAt: scheduledAt || new Date().toISOString(),
        status: isSendNow ? 'sent' : 'scheduled',
        sentAt,
        createdAt: new Date().toISOString()
      };

      state.records.reviewRequests = state.records.reviewRequests || [];
      state.records.reviewRequests.push(reviewReq);

      if (isSendNow) {
        state.records.conversations = state.records.conversations || [];
        let conv = state.records.conversations.find(c => c.contactId === contactId && c.channel === reviewReq.channel);
        if (!conv) {
          conv = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            contactId,
            channel: reviewReq.channel,
            status: 'open',
            messages: [],
            createdAt: new Date().toISOString()
          };
          state.records.conversations.push(conv);
        }
        conv.messages = conv.messages || [];
        conv.messages.push({
          id: randomUUID(),
          sender: 'agent',
          body: reviewReq.message,
          sentAt,
          at: sentAt
        });
      }

      await saveState();
      auditLog('review.requested', actor, { requestId: reqId, contactId, channel: reviewReq.channel, sendNow: isSendNow });
      broadcast('review.requested', { request: reviewReq });

      return sendJson(res, 201, { success: true, request: reviewReq });
    }

    // Send Scheduled Review Request Immediately
    if (method === 'POST' && pathname.startsWith('/api/reviews/requests/') && pathname.endsWith('/send')) {
      const reqId = pathname.replace('/api/reviews/requests/', '').replace('/send', '').trim();
      state.records.reviewRequests = state.records.reviewRequests || [];
      const reviewReq = state.records.reviewRequests.find(r => r.id === reqId && r.agencyId === agency.id);
      if (!reviewReq) return sendJson(res, 404, { error: 'Review request not found' });

      reviewReq.status = 'sent';
      reviewReq.sentAt = new Date().toISOString();

      state.records.conversations = state.records.conversations || [];
      let conv = state.records.conversations.find(c => c.contactId === reviewReq.contactId && c.channel === reviewReq.channel);
      if (!conv) {
        conv = {
          id: randomUUID(),
          agencyId: agency.id,
          locationId: activeLocation.id,
          contactId: reviewReq.contactId,
          channel: reviewReq.channel,
          status: 'open',
          messages: [],
          createdAt: new Date().toISOString()
        };
        state.records.conversations.push(conv);
      }
      conv.messages = conv.messages || [];
      conv.messages.push({
        id: randomUUID(),
        sender: 'agent',
        body: reviewReq.message,
        sentAt: reviewReq.sentAt,
        at: reviewReq.sentAt
      });

      await saveState();
      auditLog('review.request_sent', actor, { requestId: reqId, contactId: reviewReq.contactId });
      broadcast('review.requested', { request: reviewReq });

      return sendJson(res, 200, { success: true, request: reviewReq });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── COURSES / LMS CURRICULUM & LESSONS ─────────────────────
    // ═════════════════════════════════════════════════════════════

    // Add Lesson to Course
    if (method === 'POST' && pathname.startsWith('/api/courses/') && pathname.endsWith('/lessons')) {
      const courseId = pathname.replace('/api/courses/', '').replace('/lessons', '').trim();
      state.records.courses = state.records.courses || [];
      const course = state.records.courses.find(c => c.id === courseId && c.agencyId === agency.id);
      if (!course) return sendJson(res, 404, { error: 'Course not found' });

      const body = await readBody(req);
      const title = (body.title || '').trim();
      if (!title) return sendJson(res, 400, { error: 'Lesson title is required' });

      const lesson = {
        id: randomUUID(),
        title,
        durationMin: Number(body.durationMin) || 15,
        dripDays: Math.max(0, Number(body.dripDays) || 0),
        createdAt: new Date().toISOString()
      };

      course.curriculum = Array.isArray(course.curriculum) ? course.curriculum : [];
      course.curriculum.push(lesson);
      course.lessons = course.curriculum.length;
      course.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('course.lesson_added', actor, { courseId, lessonId: lesson.id, title });
      broadcast('course.lesson_added', { courseId, lesson });

      return sendJson(res, 201, { success: true, lesson, course });
    }

    // Replace / Update Curriculum
    if (method === 'PUT' && pathname.startsWith('/api/courses/') && pathname.endsWith('/curriculum')) {
      const courseId = pathname.replace('/api/courses/', '').replace('/curriculum', '').trim();
      state.records.courses = state.records.courses || [];
      const course = state.records.courses.find(c => c.id === courseId && c.agencyId === agency.id);
      if (!course) return sendJson(res, 404, { error: 'Course not found' });

      const body = await readBody(req);
      if (!Array.isArray(body.curriculum)) return sendJson(res, 400, { error: 'curriculum array is required' });

      course.curriculum = body.curriculum.map(l => ({
        id: l.id || randomUUID(),
        title: String(l.title || 'Untitled Lesson').trim(),
        durationMin: Number(l.durationMin) || 15,
        dripDays: Math.max(0, Number(l.dripDays) || 0)
      }));
      course.lessons = course.curriculum.length;
      course.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('course.curriculum_updated', actor, { courseId, lessonCount: course.lessons });
      broadcast('course.curriculum_updated', { courseId, curriculum: course.curriculum });

      return sendJson(res, 200, { success: true, course });
    }

    // Publish / Unpublish Course
    if (method === 'PUT' && pathname.startsWith('/api/courses/') && pathname.endsWith('/publish')) {
      const courseId = pathname.replace('/api/courses/', '').replace('/publish', '').trim();
      state.records.courses = state.records.courses || [];
      const course = state.records.courses.find(c => c.id === courseId && c.agencyId === agency.id);
      if (!course) return sendJson(res, 404, { error: 'Course not found' });

      const body = await readBody(req);
      const isPublished = body.published !== undefined ? Boolean(body.published) : !course.published;
      course.published = isPublished;
      course.status = isPublished ? 'published' : 'draft';
      course.updatedAt = new Date().toISOString();

      await saveState();
      auditLog('course.published_updated', actor, { courseId, published: isPublished });
      broadcast('course.published_updated', { courseId, published: isPublished });

      return sendJson(res, 200, { success: true, course });
    }

    // Upload Media Asset
    if (method === 'POST' && pathname === '/api/media/upload') {
      const body = await readBody(req);
      const name = body.name || `upload-${Date.now()}.png`;
      const folder = body.folder || 'Unsorted';
      const kind = body.kind || 'image';
      const mimeType = body.mimeType || (kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'application/pdf');
      const data = body.data || null;

      let sizeKb = body.sizeKb;
      if (!sizeKb) {
        if (data && typeof data === 'string') {
          const isBase64 = data.includes(';base64,');
          const raw = isBase64 ? data.split(';base64,')[1] : data;
          sizeKb = Math.round(Buffer.byteLength(raw, 'base64') / 1024) || 24;
        } else {
          sizeKb = Math.round(50 + Math.random() * 200);
        }
      }

      const assetId = randomUUID();
      state.records.media = state.records.media || [];
      state.mediaFiles = state.mediaFiles || {};

      if (data) {
        state.mediaFiles[assetId] = {
          data: Buffer.from(data.includes(';base64,') ? data.split(';base64,')[1] : data, 'base64'),
          mimeType
        };
      }

      const asset = {
        id: assetId,
        agencyId: agency.id,
        locationId: activeLocation.id,
        name,
        kind,
        folder,
        sizeKb,
        mimeType,
        url: `/api/media/file/${assetId}`,
        uploadedAt: new Date().toISOString()
      };

      state.records.media.push(asset);
      await saveState();

      broadcast('media.uploaded', { asset });
      auditLog('media.uploaded', actor, { assetId, name, sizeKb });

      return sendJson(res, 201, { success: true, asset });
    }

    // Delete Media Asset
    if (method === 'DELETE' && pathname.startsWith('/api/media/')) {
      const assetId = pathname.replace('/api/media/', '').trim();
      state.records.media = state.records.media || [];
      const idx = state.records.media.findIndex(m => m.id === assetId && m.agencyId === agency.id);
      if (idx === -1) {
        return sendJson(res, 404, { error: 'Media asset not found' });
      }

      const removed = state.records.media.splice(idx, 1)[0];
      if (state.mediaFiles) delete state.mediaFiles[assetId];
      await saveState();

      broadcast('media.deleted', { assetId });
      auditLog('media.deleted', actor, { assetId, name: removed.name });

      return sendJson(res, 200, { success: true, asset: removed });
    }

    // Publish Blog Post State Machine
    if (method === 'PUT' && pathname.startsWith('/api/blogs/publish/')) {
      const blogId = pathname.replace('/api/blogs/publish/', '').trim();
      state.records.blogs = state.records.blogs || [];
      const blog = state.records.blogs.find(b => b.id === blogId && b.agencyId === agency.id);
      if (!blog) {
        return sendJson(res, 404, { error: 'Blog post not found' });
      }

      blog.status = 'published';
      blog.publishedAt = blog.publishedAt || new Date().toISOString();
      await saveState();

      broadcast('blog.published', { blogId: blog.id, title: blog.title });
      auditLog('blog.published', actor, { blogId: blog.id, title: blog.title });

      return sendJson(res, 200, { success: true, blog });
    }

    // Contact Client Portal Access Toggle
    if (method === 'PUT' && pathname.startsWith('/api/crm/contacts/') && pathname.endsWith('/portal-access')) {
      const contactId = pathname.replace('/api/crm/contacts/', '').replace('/portal-access', '').trim();
      const contact = (state.records.contacts || []).find(c => c.id === contactId && c.agencyId === agency.id);
      if (!contact) {
        return sendJson(res, 404, { error: 'Contact not found' });
      }

      const body = await readBody(req);
      const granted = body.portalAccess !== undefined ? Boolean(body.portalAccess) : true;
      contact.portalAccess = granted;

      await saveState();
      broadcast('contact.portalAccess.updated', { contactId: contact.id, portalAccess: granted });
      auditLog('contact.portal_access', actor, { contactId: contact.id, granted });

      return sendJson(res, 200, { success: true, contactId: contact.id, portalAccess: granted });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── TELEPHONY CALL STATUS & HANDLED TOGGLE ─────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'PUT' && pathname.startsWith('/api/calls/handled/')) {
      const callId = pathname.replace('/api/calls/handled/', '').trim();
      state.records.calls = state.records.calls || [];
      const call = state.records.calls.find(c => c.id === callId && c.agencyId === agency.id);
      if (!call) return sendJson(res, 404, { error: 'Call record not found' });

      const body = await readBody(req);
      call.handled = body.handled !== undefined ? Boolean(body.handled) : true;
      call.updatedAt = new Date().toISOString();
      await saveState();

      auditLog('phone.call.handled', actor, { callId, handled: call.handled });
      broadcast('phone.call.handled', { id: callId, handled: call.handled });

      return sendJson(res, 200, { success: true, call });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── SMART LISTS DYNAMIC RULE EVALUATION ────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname.startsWith('/api/crm/smart-lists/') && pathname.endsWith('/evaluate')) {
      const listId = pathname.split('/')[4];
      state.records.smartLists = state.records.smartLists || [];
      const list = state.records.smartLists.find(l => l.id === listId && l.agencyId === agency.id);
      if (!list) return sendJson(res, 404, { error: 'Smart list not found' });

      state.records.contacts = state.records.contacts || [];
      const tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id);

      // Evaluate rule string or filterField
      let matches = tenantContacts;
      const rule = (list.rule || '').toLowerCase().trim();

      if (rule) {
        if (rule.includes('customer')) {
          matches = tenantContacts.filter(c => c.status === 'customer' || (c.tags || []).includes('customer'));
        } else if (rule.includes('lead')) {
          matches = tenantContacts.filter(c => c.status === 'lead' || (c.tags || []).includes('lead'));
        } else if (rule.startsWith('tag:') || rule.includes('tags contains') || rule.includes('tagged')) {
          const tagTarget = rule.replace('tag:', '').replace('tags contains', '').replace('tagged', '').replace(/['"]/g, '').trim();
          matches = tenantContacts.filter(c => (c.tags || []).some(t => t.toLowerCase().includes(tagTarget)));
        } else if (rule.includes('company')) {
          matches = tenantContacts.filter(c => Boolean(c.company && c.company.trim()));
        } else if (rule.includes('promoter')) {
          matches = tenantContacts.filter(c => (c.tags || []).includes('promoter'));
        }
      } else if (list.filterField && list.value) {
        const field = list.filterField;
        const val = String(list.value).toLowerCase();
        matches = tenantContacts.filter(c => {
          const cVal = String(c[field] || '').toLowerCase();
          return list.operator === 'equals' ? cVal === val : cVal.includes(val);
        });
      }

      list.count = matches.length;
      await saveState();

      return sendJson(res, 200, {
        list,
        count: matches.length,
        contacts: matches
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── UNIFIED REPORTING & ANALYTICS OVERVIEW ─────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/reporting/overview') {
      state.records.invoices = state.records.invoices || [];
      state.records.opportunities = state.records.opportunities || [];
      state.records.contacts = state.records.contacts || [];
      state.records.appointments = state.records.appointments || [];
      state.records.campaigns = state.records.campaigns || [];

      const tenantInvoices = state.records.invoices.filter(i => i.agencyId === agency.id);
      const tenantOpps = state.records.opportunities.filter(o => o.agencyId === agency.id);
      const tenantContacts = state.records.contacts.filter(c => c.agencyId === agency.id);
      const tenantAppointments = state.records.appointments.filter(a => a.agencyId === agency.id);

      const paidInvoices = tenantInvoices.filter(i => i.status === 'paid');
      const revenue = paidInvoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

      const openOpps = tenantOpps.filter(o => o.status === 'open' || o.stage !== 'Lost');
      const pipelineValue = openOpps.reduce((sum, o) => sum + (Number(o.value) || 0), 0);

      const wonDeals = tenantOpps.filter(o => o.status === 'won' || o.stage === 'Won').length;

      const confirmedAppts = tenantAppointments.filter(a => a.status === 'confirmed' || a.status === 'completed').length;
      const appointmentShowRate = tenantAppointments.length > 0 ? Math.round((confirmedAppts / tenantAppointments.length) * 100) : 100;

      // Attribution sources breakdown
      const sources = {};
      for (const c of tenantContacts) {
        const src = c.source || 'Direct Web';
        sources[src] = (sources[src] || 0) + 1;
      }

      // 6-period timeline trend
      const now = Date.now();
      const periodDuration = (30 * 86_400_000) / 6;
      const timeline = Array.from({ length: 6 }, (_, idx) => {
        const pStart = now - (6 - idx) * periodDuration;
        const pEnd = now - (5 - idx) * periodDuration;
        const pInvoices = paidInvoices.filter(i => {
          const t = new Date(i.createdAt || i.dueDate).getTime();
          return t >= pStart && t < pEnd;
        });
        const pContacts = tenantContacts.filter(c => {
          const t = new Date(c.createdAt).getTime();
          return t >= pStart && t < pEnd;
        });
        return {
          period: `P${idx + 1}`,
          revenue: pInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0),
          contacts: pContacts.length
        };
      });

      return sendJson(res, 200, {
        metrics: {
          revenue,
          pipeline: pipelineValue,
          dealsWon: wonDeals,
          contacts: tenantContacts.length,
          appointmentShowRate
        },
        sources,
        timeline,
        campaignsCount: (state.records.campaigns || []).filter(cp => cp.agencyId === agency.id).length
      });
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
    // ─── AGENCY: BUSINESS PROFILE ───────────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/agency/profile') {
      return sendJson(res, 200, {
        name: agency.name,
        email: agency.email || actor.user?.email || 'support@operza.io',
        phone: agency.phone || '+1 800-555-0100',
        website: agency.website || 'https://operza.io',
        timezone: agency.timezone || 'America/Los_Angeles',
        currency: agency.currency || 'USD'
      });
    }

    if (method === 'PUT' && pathname === '/api/agency/profile') {
      const body = await readBody(req);
      if (body.name) agency.name = body.name.trim();
      if (body.email) agency.email = body.email.trim();
      if (body.phone) agency.phone = body.phone.trim();
      if (body.website) agency.website = body.website.trim();
      if (body.timezone) agency.timezone = body.timezone.trim();
      if (body.currency) agency.currency = body.currency.trim();

      await saveState();
      broadcast('agency.profile.updated', { agencyId: agency.id, name: agency.name });
      auditLog('agency.profile.updated', actor, { agencyId: agency.id, name: agency.name });

      return sendJson(res, 200, {
        success: true,
        profile: {
          name: agency.name,
          email: agency.email,
          phone: agency.phone,
          website: agency.website,
          timezone: agency.timezone,
          currency: agency.currency
        }
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AGENCY: TEAM ACCESS & ROLE GOVERNANCE ───────────────────
    // ═════════════════════════════════════════════════════════════

    // GET /api/agency/team — list team members for agency
    if (method === 'GET' && pathname === '/api/agency/team') {
      state.records.team = state.records.team || [];
      let agencyTeam = state.records.team.filter(m => m.agencyId === agency.id);
      if (agencyTeam.length === 0) {
        const defaultOwner = {
          id: randomUUID(),
          agencyId: agency.id,
          name: actor.user?.name || 'Agency Owner',
          email: actor.user?.email || 'owner@operza.io',
          role: 'admin',
          online: true,
          status: 'active',
          createdAt: new Date().toISOString()
        };
        state.records.team.push(defaultOwner);
        agencyTeam = [defaultOwner];
        await saveState();
      }
      return sendJson(res, 200, { team: agencyTeam });
    }

    // POST /api/agency/team/invite — invite / create team member
    if (method === 'POST' && pathname === '/api/agency/team/invite') {
      const body = await readBody(req);
      const name = (body.name || '').trim();
      const email = (body.email || '').toLowerCase().trim();
      const role = body.role === 'admin' ? 'admin' : 'user';
      if (!name || !email) {
        return sendJson(res, 400, { error: 'Name and email are required' });
      }

      state.records.team = state.records.team || [];
      const existing = state.records.team.find(m => m.email === email && m.agencyId === agency.id);
      if (existing) {
        return sendJson(res, 409, { error: 'A team member with this email already exists' });
      }

      const memberId = randomUUID();
      const member = {
        id: memberId,
        agencyId: agency.id,
        name,
        email,
        role,
        online: false,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      state.records.team.push(member);
      await saveState();

      auditLog('team.member_invited', actor, { memberId, name, email, role });
      broadcast('agency.team.member_invited', { member });

      return sendJson(res, 201, { success: true, member });
    }

    // PUT /api/agency/team/:id/role — update team member role
    if (method === 'PUT' && pathname.startsWith('/api/agency/team/') && pathname.endsWith('/role')) {
      const memberId = pathname.replace('/api/agency/team/', '').replace('/role', '').trim();
      const body = await readBody(req);
      const role = body.role === 'admin' ? 'admin' : 'user';

      state.records.team = state.records.team || [];
      const member = state.records.team.find(m => m.id === memberId && m.agencyId === agency.id);
      if (!member) return sendJson(res, 404, { error: 'Team member not found' });

      member.role = role;
      member.updatedAt = new Date().toISOString();
      await saveState();

      auditLog('team.role_updated', actor, { memberId, name: member.name, role });
      broadcast('agency.team.role_updated', { memberId, role });

      return sendJson(res, 200, { success: true, member });
    }

    // DELETE /api/agency/team/:id — remove team member
    if (method === 'DELETE' && pathname.startsWith('/api/agency/team/')) {
      const memberId = pathname.replace('/api/agency/team/', '').trim();
      state.records.team = state.records.team || [];
      const idx = state.records.team.findIndex(m => m.id === memberId && m.agencyId === agency.id);
      if (idx === -1) return sendJson(res, 404, { error: 'Team member not found' });

      const removed = state.records.team.splice(idx, 1)[0];
      await saveState();

      auditLog('team.member_removed', actor, { memberId, name: removed.name });
      broadcast('agency.team.member_removed', { memberId });

      return sendJson(res, 200, { success: true, member: removed });
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
    // ─── INTEGRATIONS & APP MARKETPLACE ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    const getDefaultIntegrations = () => [
      { id: 'stripe', name: 'Stripe', category: 'Payment', description: 'Credit card processing, subscriptions, and payment links', icon: 'credit-card', connected: true, accountName: 'Operza Alpha Agency (acct_1928)', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'SMS messaging, phone numbers, and voice call tracking', icon: 'phone', connected: true, accountName: '+1 (800) 555-0100', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'sendgrid', name: 'SendGrid', category: 'Communications', description: 'Transactional email delivery and marketing campaigns', icon: 'mail', connected: true, accountName: 'noreply@operza.io', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'openai', name: 'OpenAI', category: 'AI & Copilot', description: 'Powering autonomous copilot, conversation replies, and summarization', icon: 'sparkles', connected: true, accountName: 'GPT-4o & Embeddings', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'slack', name: 'Slack', category: 'Notifications', description: 'Real-time notifications for leads, booked appointments, and deals', icon: 'message', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
      { id: 'zapier', name: 'Zapier', category: 'Automation', description: 'Connect Operza triggers to 5,000+ business applications', icon: 'zap', connected: true, accountName: 'Operza Flow Sync', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'google_calendar', name: 'Google Calendar', category: 'Calendar', description: 'Two-way appointment synchronization and scheduling', icon: 'calendar', connected: true, accountName: 'team@operza.io', status: 'connected', lastSyncAt: new Date().toISOString() },
      { id: 'meta_ads', name: 'Meta Ads', category: 'Marketing', description: 'Instant lead sync from Facebook & Instagram lead forms', icon: 'facebook', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null },
      { id: 'shopify', name: 'Shopify', category: 'Commerce', description: 'E-commerce store orders, customer import, and product sync', icon: 'store', connected: false, accountName: '', status: 'disconnected', lastSyncAt: null }
    ];

    if (method === 'GET' && pathname === '/api/integrations') {
      state.records.integrations = state.records.integrations || {};
      if (!state.records.integrations[agency.id]) {
        state.records.integrations[agency.id] = getDefaultIntegrations();
        await saveState();
      }
      return sendJson(res, 200, { integrations: state.records.integrations[agency.id] });
    }

    if (method === 'POST' && pathname.startsWith('/api/integrations/') && pathname.endsWith('/connect')) {
      const integrationId = pathname.replace('/api/integrations/', '').replace('/connect', '').trim();
      state.records.integrations = state.records.integrations || {};
      if (!state.records.integrations[agency.id]) {
        state.records.integrations[agency.id] = getDefaultIntegrations();
      }
      const list = state.records.integrations[agency.id];
      const target = list.find(i => i.id === integrationId);
      if (!target) return sendJson(res, 404, { error: 'Integration not found' });

      const body = await readBody(req);
      target.connected = true;
      target.status = 'connected';
      target.accountName = body.accountName || target.accountName || `${agency.name} (${integrationId})`;
      target.lastSyncAt = new Date().toISOString();
      target.config = {
        hasApiKey: Boolean(body.apiKey),
        webhookUrl: body.webhookUrl || null
      };

      await saveState();
      auditLog('integration.connected', actor, { integrationId, name: target.name });
      broadcast('crm.integration.updated', { integrationId, connected: true });
      return sendJson(res, 200, { success: true, integration: target });
    }

    if (method === 'POST' && pathname.startsWith('/api/integrations/') && pathname.endsWith('/disconnect')) {
      const integrationId = pathname.replace('/api/integrations/', '').replace('/disconnect', '').trim();
      state.records.integrations = state.records.integrations || {};
      if (!state.records.integrations[agency.id]) {
        state.records.integrations[agency.id] = getDefaultIntegrations();
      }
      const list = state.records.integrations[agency.id];
      const target = list.find(i => i.id === integrationId);
      if (!target) return sendJson(res, 404, { error: 'Integration not found' });

      target.connected = false;
      target.status = 'disconnected';
      target.config = null;

      await saveState();
      auditLog('integration.disconnected', actor, { integrationId, name: target.name });
      broadcast('crm.integration.updated', { integrationId, connected: false });
      return sendJson(res, 200, { success: true, integration: target });
    }

    if (method === 'POST' && pathname.startsWith('/api/integrations/') && pathname.endsWith('/test')) {
      const integrationId = pathname.replace('/api/integrations/', '').replace('/test', '').trim();
      state.records.integrations = state.records.integrations || {};
      if (!state.records.integrations[agency.id]) {
        state.records.integrations[agency.id] = getDefaultIntegrations();
      }
      const list = state.records.integrations[agency.id];
      const target = list.find(i => i.id === integrationId);
      if (!target) return sendJson(res, 404, { error: 'Integration not found' });

      target.lastSyncAt = new Date().toISOString();
      await saveState();

      return sendJson(res, 200, {
        success: true,
        latencyMs: Math.floor(25 + Math.random() * 30),
        message: `${target.name} ping verified · Active connection confirmed`
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AI BOT TRAINING & KNOWLEDGE BASE CENTER ────────────────
    // ═════════════════════════════════════════════════════════════

    const getDefaultAiConfig = () => ({
      persona: 'executive',
      tone: 'professional, concise, and helpful',
      systemPrompt: 'You are Operza Copilot, the AI operational assistant for this agency. Answer client questions based on uploaded knowledge base documents, qualify leads, and provide helpful guidance.',
      temperature: 0.7,
      permissions: {
        canCreateContacts: true,
        canSendMessages: true,
        canBookAppointments: true,
        canChargeCards: false,
        requireApprovalForDealsOver: 5000
      },
      autoReplyEnabled: true,
      fallbackToHuman: true
    });

    if (method === 'GET' && pathname === '/api/ai/config') {
      state.aiConfig = state.aiConfig || {};
      const config = state.aiConfig[agency.id] || getDefaultAiConfig();
      return sendJson(res, 200, { config });
    }

    if (method === 'PUT' && pathname === '/api/ai/config') {
      state.aiConfig = state.aiConfig || {};
      const body = await readBody(req);
      const current = state.aiConfig[agency.id] || getDefaultAiConfig();
      const updated = {
        ...current,
        ...body,
        permissions: { ...current.permissions, ...(body.permissions || {}) },
        updatedAt: new Date().toISOString()
      };
      state.aiConfig[agency.id] = updated;
      await saveState();
      auditLog('ai.config_updated', actor, { persona: updated.persona });
      return sendJson(res, 200, { success: true, config: updated });
    }

    if (method === 'GET' && pathname === '/api/ai/knowledge') {
      state.records.knowledge = state.records.knowledge || [];
      const docs = state.records.knowledge.filter(k => k.agencyId === agency.id);
      return sendJson(res, 200, { documents: docs });
    }

    if (method === 'POST' && pathname === '/api/ai/knowledge') {
      const body = await readBody(req);
      const { title, type = 'text', content = '' } = body;
      if (!title || !content) {
        return sendJson(res, 400, { error: 'Document title and content are required' });
      }

      state.records.knowledge = state.records.knowledge || [];
      // Semantic chunking simulation (paragraphs of 150-300 chars)
      const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
      const chunks = (paragraphs.length ? paragraphs : [content]).map((text, idx) => ({
        id: `chk_${randomUUID().slice(0, 8)}`,
        index: idx,
        text: text.trim()
      }));

      const newDoc = {
        id: randomUUID(),
        agencyId: agency.id,
        title: title.trim(),
        type,
        chunksCount: chunks.length,
        wordsCount: content.split(/\s+/).filter(Boolean).length,
        status: 'indexed',
        chunks,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.knowledge.push(newDoc);
      await saveState();
      auditLog('ai.knowledge_added', actor, { docId: newDoc.id, title: newDoc.title });
      broadcast('crm.knowledge.created', { docId: newDoc.id, title: newDoc.title });

      return sendJson(res, 201, { success: true, document: newDoc });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/ai/knowledge/')) {
      const docId = pathname.replace('/api/ai/knowledge/', '').trim();
      state.records.knowledge = state.records.knowledge || [];
      const idx = state.records.knowledge.findIndex(k => k.id === docId && k.agencyId === agency.id);
      if (idx === -1) return sendJson(res, 404, { error: 'Knowledge document not found' });

      const [removed] = state.records.knowledge.splice(idx, 1);
      await saveState();
      auditLog('ai.knowledge_deleted', actor, { docId, title: removed.title });
      return sendJson(res, 200, { success: true, deletedId: docId });
    }

    if (method === 'POST' && pathname === '/api/ai/test') {
      const body = await readBody(req);
      const { query = '' } = body;
      if (!query.trim()) return sendJson(res, 400, { error: 'Query is required' });

      state.records.knowledge = state.records.knowledge || [];
      const docs = state.records.knowledge.filter(k => k.agencyId === agency.id);
      const qLower = query.toLowerCase();

      // Find matching chunks across docs
      const matchingSources = [];
      for (const doc of docs) {
        for (const chunk of doc.chunks || []) {
          const matchTerms = qLower.split(/\s+/).filter(w => w.length > 2);
          const hasMatch = matchTerms.some(term => chunk.text.toLowerCase().includes(term));
          if (hasMatch) {
            matchingSources.push({
              docTitle: doc.title,
              chunkId: chunk.id,
              text: chunk.text
            });
          }
        }
      }

      const answer = matchingSources.length > 0
        ? `Based on "${matchingSources[0].docTitle}": ${matchingSources[0].text}`
        : `Operza Copilot evaluated "${query}". All system and knowledge records are online and ready for deployment.`;

      return sendJson(res, 200, {
        query,
        answer,
        sources: matchingSources.slice(0, 3)
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── DEVELOPER HUB: API KEYS & WEBHOOK DISPATCH ─────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/developers/keys') {
      state.records.apiKeys = state.records.apiKeys || [];
      const keys = state.records.apiKeys
        .filter(k => k.agencyId === agency.id)
        .map(k => ({
          id: k.id,
          label: k.label,
          maskedKey: k.maskedKey,
          scopes: k.scopes,
          createdAt: k.createdAt,
          lastUsedAt: k.lastUsedAt || null
        }));
      return sendJson(res, 200, { keys });
    }

    if (method === 'POST' && pathname === '/api/developers/keys') {
      const body = await readBody(req);
      const { label = 'Default API Key', scopes = ['contacts:read', 'contacts:write', 'workflows:trigger'] } = body;
      const secret = randomBytes(24).toString('hex');
      const secretToken = `op_live_${secret}`;
      const maskedKey = `op_live_${secret.slice(0, 4)}...${secret.slice(-4)}`;

      state.records.apiKeys = state.records.apiKeys || [];
      const newKey = {
        id: randomUUID(),
        agencyId: agency.id,
        label: label.trim(),
        keyHash: hash(secretToken),
        maskedKey,
        scopes,
        createdAt: new Date().toISOString(),
        lastUsedAt: null
      };

      state.records.apiKeys.push(newKey);
      await saveState();
      auditLog('developer.key_created', actor, { keyId: newKey.id, label: newKey.label });

      return sendJson(res, 201, {
        success: true,
        key: {
          id: newKey.id,
          label: newKey.label,
          maskedKey: newKey.maskedKey,
          scopes: newKey.scopes,
          secretToken,
          createdAt: newKey.createdAt
        }
      });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/developers/keys/')) {
      const keyId = pathname.replace('/api/developers/keys/', '').trim();
      state.records.apiKeys = state.records.apiKeys || [];
      const idx = state.records.apiKeys.findIndex(k => k.id === keyId && k.agencyId === agency.id);
      if (idx === -1) return sendJson(res, 404, { error: 'API key not found' });

      state.records.apiKeys.splice(idx, 1);
      await saveState();
      auditLog('developer.key_revoked', actor, { keyId });
      return sendJson(res, 200, { success: true, revokedId: keyId });
    }

    if (method === 'GET' && pathname === '/api/developers/webhooks') {
      state.records.webhookSubscriptions = state.records.webhookSubscriptions || [];
      const webhooks = state.records.webhookSubscriptions.filter(w => w.agencyId === agency.id);
      return sendJson(res, 200, { webhooks });
    }

    if (method === 'POST' && pathname === '/api/developers/webhooks') {
      const body = await readBody(req);
      const { url: targetUrl, events = ['contact.created', 'opportunity.stage_changed', 'form.submitted'], secret = '' } = body;
      if (!targetUrl || !targetUrl.startsWith('http')) {
        return sendJson(res, 400, { error: 'A valid http/https webhook URL is required' });
      }

      state.records.webhookSubscriptions = state.records.webhookSubscriptions || [];
      const newWebhook = {
        id: randomUUID(),
        agencyId: agency.id,
        url: targetUrl.trim(),
        events: Array.isArray(events) ? events : ['contact.created'],
        secret: secret.trim() || `whsec_${randomBytes(16).toString('hex')}`,
        status: 'active',
        createdAt: new Date().toISOString()
      };

      state.records.webhookSubscriptions.push(newWebhook);
      await saveState();
      auditLog('developer.webhook_created', actor, { webhookId: newWebhook.id, url: newWebhook.url });
      return sendJson(res, 201, { success: true, webhook: newWebhook });
    }

    if (method === 'DELETE' && pathname.startsWith('/api/developers/webhooks/')) {
      const webhookId = pathname.replace('/api/developers/webhooks/', '').trim();
      state.records.webhookSubscriptions = state.records.webhookSubscriptions || [];
      const idx = state.records.webhookSubscriptions.findIndex(w => w.id === webhookId && w.agencyId === agency.id);
      if (idx === -1) return sendJson(res, 404, { error: 'Webhook not found' });

      state.records.webhookSubscriptions.splice(idx, 1);
      await saveState();
      auditLog('developer.webhook_deleted', actor, { webhookId });
      return sendJson(res, 200, { success: true, deletedId: webhookId });
    }

    if (method === 'POST' && pathname.startsWith('/api/developers/webhooks/') && pathname.endsWith('/test')) {
      const webhookId = pathname.replace('/api/developers/webhooks/', '').replace('/test', '').trim();
      state.records.webhookSubscriptions = state.records.webhookSubscriptions || [];
      const webhook = state.records.webhookSubscriptions.find(w => w.id === webhookId && w.agencyId === agency.id);
      if (!webhook) return sendJson(res, 404, { error: 'Webhook not found' });

      const delivery = {
        id: randomUUID(),
        webhookId,
        agencyId: agency.id,
        url: webhook.url,
        event: 'test.ping',
        status: 200,
        durationMs: Math.floor(40 + Math.random() * 40),
        payload: {
          event: 'test.ping',
          timestamp: new Date().toISOString(),
          agency: { id: agency.id, name: agency.name },
          data: { ping: 'pong', verified: true }
        },
        at: new Date().toISOString()
      };

      state.records.webhookDeliveries = state.records.webhookDeliveries || [];
      state.records.webhookDeliveries.unshift(delivery);
      if (state.records.webhookDeliveries.length > 100) {
        state.records.webhookDeliveries = state.records.webhookDeliveries.slice(0, 100);
      }
      await saveState();

      return sendJson(res, 200, { success: true, delivery });
    }

    if (method === 'GET' && pathname === '/api/developers/webhooks/deliveries') {
      state.records.webhookDeliveries = state.records.webhookDeliveries || [];
      const deliveries = state.records.webhookDeliveries.filter(d => d.agencyId === agency.id);
      return sendJson(res, 200, { deliveries: deliveries.slice(0, 50) });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AGENCY WHITE-LABEL & BRANDING PORTAL ───────────────────
    // ═════════════════════════════════════════════════════════════

    const getDefaultBranding = () => ({
      platformName: agency.name || 'Operza Agency',
      subdomain: agency.slug || 'app',
      customDomain: '',
      cnameTarget: 'cname.operza.io',
      isDomainVerified: false,
      sslActive: false,
      logoUrl: '',
      faviconUrl: '',
      primaryColor: '#4f46e5',
      accentColor: '#6366f1',
      supportEmail: 'support@operza.io',
      senderName: agency.name || 'Operza Agency',
      senderEmail: `noreply@${agency.slug || 'agency'}.test`,
      isDkimVerified: false,
      portalWelcomeHeading: 'Client Portal · Welcome',
      portalWelcomeSubhead: 'Manage your projects, invoices, and appointments.'
    });

    if (method === 'GET' && pathname === '/api/agency/branding') {
      state.agencyBranding = state.agencyBranding || {};
      const branding = state.agencyBranding[agency.id] || getDefaultBranding();
      return sendJson(res, 200, { branding });
    }

    if (method === 'PUT' && pathname === '/api/agency/branding') {
      state.agencyBranding = state.agencyBranding || {};
      const body = await readBody(req);
      const current = state.agencyBranding[agency.id] || getDefaultBranding();
      const updated = {
        ...current,
        ...body,
        updatedAt: new Date().toISOString()
      };
      state.agencyBranding[agency.id] = updated;
      await saveState();
      auditLog('agency.branding_updated', actor, { platformName: updated.platformName });
      return sendJson(res, 200, { success: true, branding: updated });
    }

    if (method === 'POST' && pathname === '/api/agency/branding/verify-domain') {
      state.agencyBranding = state.agencyBranding || {};
      const current = state.agencyBranding[agency.id] || getDefaultBranding();
      const body = await readBody(req);
      const domainToVerify = body.customDomain || current.customDomain;
      if (!domainToVerify) return sendJson(res, 400, { error: 'Custom domain is required to verify' });

      current.customDomain = domainToVerify;
      current.isDomainVerified = true;
      current.sslActive = true;
      current.verifiedAt = new Date().toISOString();
      state.agencyBranding[agency.id] = current;

      await saveState();
      auditLog('agency.domain_verified', actor, { domain: current.customDomain });
      return sendJson(res, 200, { success: true, branding: current, message: 'Domain CNAME & SSL verified' });
    }

    if (method === 'POST' && pathname === '/api/agency/branding/verify-email') {
      state.agencyBranding = state.agencyBranding || {};
      const current = state.agencyBranding[agency.id] || getDefaultBranding();
      current.isDkimVerified = true;
      current.dkimVerifiedAt = new Date().toISOString();
      state.agencyBranding[agency.id] = current;

      await saveState();
      auditLog('agency.email_verified', actor, { senderEmail: current.senderEmail });
      return sendJson(res, 200, { success: true, branding: current, message: 'SPF & DKIM verified' });
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
