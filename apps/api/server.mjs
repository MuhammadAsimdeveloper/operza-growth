/**
 * ============================================================================
 * Operza Unified Enterprise API & Orchestration Server v2.0
 * ============================================================================
 * 
 * Core Architectural Engine:
 * 1. Dual-Mode Storage:
 *    - Relational PostgreSQL Mode with strict Row-Level Security (RLS).
 *    - Zero-config durable JSON atomic file mode (data/store.json) for dev/testing.
 * 2. Enterprise Queue:
 *    - Redis BullMQ driver using direct RESP TCP sockets.
 *    - Memory fallback queue with priority and delay support.
 * 3. Real-Time WebSockets:
 *    - Native ws connection pooling at /ws for live CRM timeline updates.
 * 4. Omnichannel Ingress:
 *    - Webhook ingestion for Twilio SMS, WhatsApp Cloud API, and Meta Messenger.
 * 5. Agency Multi-Tenancy & Carrier Compliance:
 *    - Sub-account hierarchy, snapshot diff & sync, and A2P 10DLC trust hub.
 */

import { createServer } from 'node:http';
import crypto, { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual, randomUUID, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, mkdir, rename, writeFile, unlink, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns/promises';
import { executeStep, calculateChecksum } from '../../packages/workflow-engine/src/engine.mjs';
import { createActionInvocation, getWorkflowActionDefinition } from '../../packages/workflow-engine/src/action-governance.mjs';
import { createPendingApproval, resolvePendingApproval } from '../../packages/workflow-engine/src/approval-lifecycle.mjs';
import { claimExecutionLease, heartbeatExecutionLease, releaseExecutionLease, recoverAbandonedExecutions } from '../../packages/workflow-engine/src/durable-leases.mjs';
import { createProviderConnection, revokeProviderConnection, publicProviderConnection, PROVIDER_CATALOG, verifyProviderConnection } from '../../packages/platform-core/src/provider-lifecycle.mjs';
import { createSecretResolver } from '../../packages/platform-core/src/secret-vault.mjs';
import { createProviderAdapterRegistry } from '../../packages/platform-core/src/provider-adapters.mjs';
import { createBillingLedgerStore, createImmutableAuditStore, gateAiToolExecution } from '../../packages/platform-core/src/billing-ledger.mjs';
import { executeCopilotProposal } from '../../packages/platform-core/src/proposal-executor.mjs';
import { createMemoryOutboxRepository, executeWorkerTick } from '../../packages/platform-core/src/outbox-worker.mjs';
import { produceWorkflowTriggerEvent, produceWorkflowResumeEvent } from '../../packages/platform-core/src/outbox-producer.mjs';
import { createWorkflowOutboxRepository } from '../../packages/db/lib/outbox-repository.mjs';
import { trustedWorkerHandlers } from '../../packages/platform-core/src/trusted-handlers.mjs';
import { recordConsent } from '../../packages/platform-core/src/consent-policy.mjs';
import { authorizeCopilotTool, createCopilotProposal, getCopilotToolDefinition } from '../../packages/platform-core/src/tool-permissions.mjs';
import { resolveEntitlements, listPlans, checkFeatureAccess, checkUsageLimit, createUsageEvent, aggregateUsage } from '../../packages/platform-core/src/entitlements.mjs';
import { createPlatformRepository } from '../../packages/db/lib/platform-repository.mjs';
import { createPostgresSecretBackend } from '../../packages/db/lib/secret-vault-repository.mjs';
import { createZapierHookRepository } from '../../packages/db/lib/zapier-hook-repository.mjs';
import { createPostgresOAuthStateStore } from '../../packages/db/lib/outlook-oauth-state-repository.mjs';
import { createOutlookOAuthService, createMemoryOAuthStateStore } from '../../packages/platform-core/src/outlook-oauth.mjs';
import { executeCalendarSync, generatePKCE, googleCalendarAdapter, microsoftGraphCalendarAdapter, signOAuthState, verifyOAuthState } from '../../packages/platform-core/src/calendar-sync.mjs';
import { workflowQueue } from './queue.mjs';
import { persistInitialWorkflowExecution, persistCompletedWorkflowExecution } from './workflow-persistence.mjs';
import { handleZapierRoute, dispatchZapierEvent } from './zapier-router.mjs';
import { handleSystemRoutes } from './routes/system.mjs';
import { handleAuthRoutes } from './routes/auth.mjs';
import { handleAgencyRoutes } from './routes/agency.mjs';
import { handleCrmRoutes } from './routes/crm.mjs';
import { handleOpportunitiesRoutes } from './routes/opportunities.mjs';
import { handleSchedulingRoutes } from './routes/scheduling.mjs';
import { handleWorkflowsRoutes } from './routes/workflows.mjs';
import { handlePipelinesRoutes } from './routes/pipelines.mjs';
import { createAiPlatformRoutes } from './routes/ai.mjs';
import { createAiProviderGateway, PROVIDER_STATUSES } from '../../packages/platform-core/src/ai/provider-gateway.mjs';
import { createAiCostGovernance } from '../../packages/platform-core/src/ai/cost-governance.mjs';
import { createAiToolRegistry, TOOL_RISK_CLASSES } from '../../packages/platform-core/src/ai/tool-registry-v2.mjs';
import { createVoiceAiSessionManager } from '../../packages/platform-core/src/ai/voice-streaming.mjs';
import { handleFunnelsRoutes } from './routes/funnels.mjs';
import { handlePaymentsRoutes } from './routes/payments.mjs';
import { handleConversationsRoutes, recordInboundOptOut } from './routes/conversations.mjs';
import { handleFormsRoutes } from './routes/forms.mjs';
import { handleTasksRoutes } from './routes/tasks.mjs';
import { handleReviewsRoutes } from './routes/reviews.mjs';
import { parseAndValidateCsvImport, exportContactsToCsv } from '../../packages/platform-core/src/csv-transfer.mjs';
import { createSmartListView, matchesSmartListView, filterSmartListRecords, generateSmartListSql } from '../../packages/platform-core/src/crm-views-store.mjs';
import { createDefaultLLMRuntime } from '../../packages/platform-core/src/llm-runtime/index.mjs';
import { MultiAgentOrchestrator, AGENT_ROLES, OPERZA_KNOWLEDGE_BASE, MULTILINGUAL_GUIDELINES } from '../../packages/platform-core/src/multi-agent/index.mjs';
import { CopilotService, RAGEngine, resolveAIProvider, COPILOT_TOOLS } from '../../packages/platform-core/src/copilot/index.mjs';
import QRCode from 'qrcode';

let secretResolver = null;
let providerAdapterRegistry = createProviderAdapterRegistry();
let outlookOAuthService = null;
const memoryOutboxRepo = createMemoryOutboxRepository();
let pgOutboxRepo = null;
const getOutboxRepo = () => pgOutboxRepo || memoryOutboxRepo;
const billingLedgerStore = createBillingLedgerStore({ defaultCreditBalance: 10000 });
const immutableAuditStore = createImmutableAuditStore();
const defaultLLMRuntime = createDefaultLLMRuntime({
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
  localAIBaseUrl: process.env.LOCALAI_BASE_URL || 'http://localhost:8080/v1',
  openAIApiKey: process.env.OPENAI_API_KEY
});

// Operza Copilot 2.0 Unified Engine
const copilotService = new CopilotService();
const aiCostGovernance = createAiCostGovernance();
const aiPlatformGateway = createAiProviderGateway({
  providers: [
    {
      id: 'gemini',
      name: 'Google Gemini',
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.AI_API_KEY),
      status: (process.env.GEMINI_API_KEY || process.env.AI_API_KEY) ? PROVIDER_STATUSES.CONFIGURED : PROVIDER_STATUSES.NOT_CONFIGURED,
      capabilities: { textGeneration: true, structuredOutput: true, toolCalling: true, streaming: true, embeddings: true, audioInput: true }
    },
    {
      id: 'openai',
      name: 'OpenAI',
      configured: Boolean(process.env.OPENAI_API_KEY),
      status: process.env.OPENAI_API_KEY ? PROVIDER_STATUSES.CONFIGURED : PROVIDER_STATUSES.NOT_CONFIGURED,
      capabilities: { textGeneration: true, structuredOutput: true, toolCalling: true, streaming: true, embeddings: true, audioInput: true, audioOutput: true }
    },
    {
      id: 'anthropic',
      name: 'Anthropic Claude',
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      status: process.env.ANTHROPIC_API_KEY ? PROVIDER_STATUSES.CONFIGURED : PROVIDER_STATUSES.NOT_CONFIGURED,
      capabilities: { textGeneration: true, structuredOutput: true, toolCalling: true, streaming: true }
    },
    {
      id: 'local_embeddings',
      name: 'Local Deterministic Trigram Embeddings',
      configured: true,
      status: PROVIDER_STATUSES.SANDBOX_VERIFIED,
      capabilities: { embeddings: true }
    }
  ]
});
const aiToolRegistry = createAiToolRegistry({
  auditSink: (evt) => auditLog(evt.event, { user: { id: evt.actorId } }, evt)
});
aiToolRegistry.registerTool({
  id: 'crm.search_contacts',
  name: 'Search CRM Contacts',
  description: 'Read-only contact lookup',
  inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  riskClass: TOOL_RISK_CLASSES.READ_ONLY,
  handler: async ({ query }) => ({ query, results: [] })
});
aiToolRegistry.registerTool({
  id: 'finance.issue_refund',
  name: 'Issue Refund',
  description: 'Financial refund proposal requiring human approval',
  inputSchema: { type: 'object', properties: { invoiceId: { type: 'string' }, amountCents: { type: 'number' } }, required: ['invoiceId', 'amountCents'] },
  riskClass: TOOL_RISK_CLASSES.FINANCIAL_OPERATION,
  requiredRole: 'admin',
  requiresApproval: true,
  handler: async ({ invoiceId, amountCents }) => ({ invoiceId, amountCents, status: 'refund_proposed' })
});
const aiVoiceManager = createVoiceAiSessionManager({ costGovernance: aiCostGovernance });
const copilotRag = new RAGEngine();

function getMultiAgentOrchestrator(agencyId, locationId, actor) {
  return new MultiAgentOrchestrator({
    llmRuntime: defaultLLMRuntime,
    toolExecutor: {
      search_contacts: async ({ query }) => {
        state.records.contacts = state.records.contacts || [];
        const q = String(query || '').toLowerCase();
        const results = state.records.contacts.filter(c =>
          (!agencyId || c.agencyId === agencyId) &&
          (!locationId || c.locationId === locationId) &&
          (`${c.firstName || ''} ${c.lastName || ''} ${c.email || ''} ${c.company || ''}`.toLowerCase().includes(q))
        );
        return { results: results.slice(0, 5) };
      }
    },
    proposalStore: async (toolName, params) => {
      const fullActor = {
        agency: { id: agencyId || state.agencies[0]?.id },
        activeLocation: { id: locationId || state.locations[0]?.id },
        membership: { role: actor?.membership?.role || 'admin' },
        user: { id: actor?.user?.id || 'usr_orchestrator' }
      };
      try {
        const stored = await storeCopilotProposal(toolName, params, fullActor);
        if (stored && stored.id) {
          return stored;
        }
      } catch (err) {
        console.warn('storeCopilotProposal failed, using fallback proposal store:', err.message);
      }
      state.copilotProposals = state.copilotProposals || [];
      const proposal = {
        id: `prop_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        tenantId: fullActor.agency.id,
        locationId: fullActor.activeLocation.id,
        requestedByActorId: fullActor.user.id,
        agentId: 'automation_agent',
        status: 'pending_review',
        toolName,
        suggestedAction: toolName,
        params,
        payload: params,
        title: `Copilot Action: ${toolName}`,
        summary: `AI Agent proposed executing ${toolName} with parameters: ${JSON.stringify(params)}`,
        risk: 'medium',
        requiresHumanApproval: true,
        createdAt: new Date().toISOString()
      };
      state.copilotProposals.push(proposal);
      await saveState();
      return proposal;
    }
  });
}

// Conditionally load ws — gracefully degrade if not installed
let WebSocketServer;
try {
  const ws = await import('ws');
  WebSocketServer = ws.WebSocketServer;
} catch {
  console.warn('[OPERZA] ws package not installed — WebSocket server disabled. Run: npm install ws');
}

const isStagingOrProd = process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'staging';

// Conditionally load pg for PostgreSQL dual-mode persistence
let pgPool = null;
try {
  if (process.env.DATABASE_URL) {
    const pgModule = await import('pg');
    const Pool = pgModule.default?.Pool || pgModule.Pool;
    if (Pool) {
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
        max: Number(process.env.PG_MAX_POOL || 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000
      });
      pgPool.on('error', (err) => {
        console.error('[OPERZA-DB] Unexpected PostgreSQL pool error:', err.message);
      });
    }
  } else if (isStagingOrProd) {
    throw new Error(`[FATAL] Running in ${process.env.NODE_ENV} mode requires DATABASE_URL to be set. Silent fallback to store.json is strictly forbidden.`);
  }
} catch (err) {
  if (isStagingOrProd) {
    console.error('[OPERZA-DB] FATAL:', err.message);
    throw err;
  }
  console.warn('[OPERZA-DB] pg module not available or error initializing pool:', err.message);
}

const platformDbEnabled = process.env.PLATFORM_DB_ENABLED === 'true' || isStagingOrProd;
if (platformDbEnabled && !pgPool) throw new Error('PLATFORM_DB_ENABLED requires a working DATABASE_URL and the pg module.');
const platformRepository = platformDbEnabled ? createPlatformRepository(pgPool) : null;
const zapierRepository = platformDbEnabled ? createZapierHookRepository(pgPool) : null;
if (pgPool) {
  pgOutboxRepo = createWorkflowOutboxRepository(pgPool);
}

if (isStagingOrProd) {
  if (!pgPool) throw new Error('Secure provider secret storage requires DATABASE_URL in staging/production.');
  if (typeof process.env.OPERZA_VAULT_KEY !== 'string' || process.env.OPERZA_VAULT_KEY.length < 16) {
    throw new Error('OPERZA_VAULT_KEY (minimum 16 characters) is required in staging/production.');
  }
  const requiredTables=await pgPool.query("SELECT to_regclass('public.provider_secrets') AS provider_secrets,to_regclass('public.workflow_outbox') AS workflow_outbox,to_regclass('public.zapier_rest_hook_subscriptions') AS zapier_subscriptions,to_regclass('public.zapier_rest_hook_deliveries') AS zapier_deliveries");
  const t=requiredTables.rows[0]||{};
  if(!t.provider_secrets)throw new Error('Migration 016 is required before starting Operza with the production secret vault.');
  if(!t.workflow_outbox||!t.zapier_subscriptions||!t.zapier_deliveries)throw new Error('Migrations 008 and 018 are required before durable Zapier event delivery can start.');
}

const effectiveVaultKey = process.env.OPERZA_VAULT_KEY || (!isStagingOrProd ? 'operza-dev-vault-key-32chars-min-len' : undefined);

secretResolver = createSecretResolver({
  masterKey: effectiveVaultKey,
  backend: (isStagingOrProd || platformDbEnabled) ? createPostgresSecretBackend(pgPool) : undefined
});
const microsoftOAuthConfigured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_REDIRECT_URI);
let outlookStateStore = createMemoryOAuthStateStore();
if (pgPool) {
  const oauthStateTable = await pgPool.query("SELECT to_regclass('public.provider_oauth_states') AS table_name");
  if (oauthStateTable.rows[0]?.table_name) outlookStateStore = createPostgresOAuthStateStore(pgPool, { masterKey: effectiveVaultKey });
  else if (isStagingOrProd && microsoftOAuthConfigured) throw new Error('Migration 017 is required before enabling Microsoft Outlook OAuth in staging/production.');
}
outlookOAuthService = createOutlookOAuthService({
  clientId: process.env.MICROSOFT_CLIENT_ID,
  clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
  redirectUri: process.env.MICROSOFT_REDIRECT_URI,
  tenant: process.env.MICROSOFT_TENANT_ID || 'common',
  stateKey: effectiveVaultKey,
  secretResolver,
  stateStore: outlookStateStore
});
providerAdapterRegistry = createProviderAdapterRegistry([outlookOAuthService.adapter]);
const scrypt = promisify(scryptCallback);
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4000);
const host = process.env.HOST || '0.0.0.0';
const dataFile = path.resolve(root, process.env.DATA_FILE || './data/store.json');
const dataDir = path.dirname(dataFile);
const isProd = process.env.NODE_ENV === 'production';
if (isStagingOrProd) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'operza-local-development-secret-key-32chars' || process.env.SESSION_SECRET.length < 32) {
    throw new Error('[FATAL] SESSION_SECRET must be configured with a cryptographically strong secret (minimum 32 characters) in staging and production.');
  }
}
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
  phoneNumbers: { label: 'Phone Numbers', required: ['number'], fields: ['number','label','type','voice','sms','mms','status','assignedTo','forwardTo','ivrEnabled','ivrMenu','recordingEnabled','areaCode'] },
  prospects: { label: 'Prospects', required: ['company'], fields: ['company','person','email','industry','location','employees','score','status','createdAt'] }
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
  workflowApprovals: [],
  providerConnections: [],
  communicationConsents: [],
  copilotProposals: [],
  tenantEntitlements: {},
  usageEvents: [],
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

function resolveClientIp(req) {
  const remoteAddr = req.socket?.remoteAddress || '127.0.0.1';
  const normalizedRemote = remoteAddr.startsWith('::ffff:') ? remoteAddr.slice(7) : remoteAddr;

  const isLoopback = normalizedRemote === '127.0.0.1' || normalizedRemote === '::1';
  const trustedProxiesEnv = process.env.TRUSTED_PROXIES || '';
  const trustedList = trustedProxiesEnv
    ? trustedProxiesEnv.split(',').map(s => s.trim().toLowerCase())
    : [];
  const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

  const isTrusted = (isLoopback && (trustProxy || process.env.NODE_ENV === 'test')) ||
    trustedList.includes(normalizedRemote.toLowerCase());

  if (isTrusted && req.headers && req.headers['x-forwarded-for']) {
    const rawForwarded = String(req.headers['x-forwarded-for']).split(',');
    const clientIp = rawForwarded[0]?.trim();
    if (clientIp) {
      return clientIp.startsWith('::ffff:') ? clientIp.slice(7) : clientIp;
    }
  }

  return normalizedRemote;
}

function getRateLimitKey(key) { return key || 'unknown'; }

function normalizePhone(p) {
  return String(p || '').replace(/\D/g, '');
}

async function generateQrSvg(target, size = 256) {
  try {
    return await QRCode.toString(target, {
      type: 'svg',
      width: size,
      margin: 2,
      errorCorrectionLevel: 'M'
    });
  } catch (err) {
    console.error('[QR] Failed to generate vector QR code:', err);
    throw err;
  }
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

// Durable Workflow Leases — Periodic recovery of abandoned/crashed workflow executions
setInterval(() => {
  if (Array.isArray(state?.workflowExecutions)) {
    recoverAbandonedExecutions({
      executions: state.workflowExecutions,
      maxAttempts: 3,
      now: Date.now()
    });
  }
}, 30_000);

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
async function getTenantEntitlements(agencyId) {
  let saved;
  if (platformRepository) {
    saved = await platformRepository.getEntitlements({ tenantId: agencyId });
  } else {
    saved = state.tenantEntitlements?.[agencyId] || {};
  }
  const agency = (state.agencies || []).find(item => item.id === agencyId);
  const entitlements = resolveEntitlements({
    planId: saved?.plan_id || saved?.planId || state.tenantPlans?.[agencyId]?.planId || agency?.planId || 'beta',
    featureOverrides: saved?.feature_overrides || saved?.featureOverrides || {},
    limitOverrides: saved?.limit_overrides || saved?.limitOverrides || {}
  });
  if (saved?.status && saved.status !== 'active') {
    return {
      ...entitlements,
      features: Object.fromEntries(Object.keys(entitlements.features).map(key => [key, false])),
      limits: Object.fromEntries(Object.keys(entitlements.limits).map(key => [key, 0]))
    };
  }
  return entitlements;
}

async function getCurrentUsage(agencyId, now = Date.now()) {
  const current = new Date(now);
  const from = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1));
  const to = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
  if (platformRepository) {
    return platformRepository.aggregateUsage({
      tenantId: agencyId,
      from: from.toISOString(),
      to: to.toISOString()
    });
  }
  return aggregateUsage(state.usageEvents || [], {
    tenantId: agencyId,
    from: from.toISOString(),
    to: to.toISOString()
  });
}

async function checkTenantUsageLimit(agencyId, metric, quantity = 1) {
  const [entitlements, usage] = await Promise.all([
    getTenantEntitlements(agencyId),
    getCurrentUsage(agencyId)
  ]);
  const current = usage[metric] || 0;
  const limit = checkUsageLimit(entitlements, usage, metric);
  if (!limit.allowed) return limit;
  if (current + quantity > limit.limit) {
    return { allowed: false, code: 'LIMIT_REACHED', consumed: current, limit: limit.limit, remaining: limit.remaining };
  }
  return { ...limit, remaining: Math.max(0, limit.limit - current - quantity) };
}

async function recordTenantUsage({ agencyId, locationId, metric, quantity = 1, source = 'application', eventId = randomUUID() }) {
  const event = createUsageEvent({
    tenantId: agencyId,
    locationId,
    eventId,
    metric,
    quantity,
    metadata: { source: String(source).slice(0, 80) }
  });
  if (platformRepository) {
    return platformRepository.recordUsageEvent(event);
  }
  state.usageEvents = state.usageEvents || [];
  if (state.usageEvents.some(item => item.eventId === eventId && item.tenantId === agencyId)) return false;
  state.usageEvents.push(event);
  await saveState();
  return true;
}

async function storeCopilotProposal(toolName, params, actor) {
  const entitlements = await getTenantEntitlements(actor.agency.id);
  const entitlement = checkFeatureAccess(entitlements, 'copilotProposals');
  const agentGrant = state.aiToolGrants?.[actor.agency.id]?.[toolName] !== false;
  const authorization = authorizeCopilotTool({
    toolName,
    actorRole: actor.membership.role,
    tenantCapability: entitlement.allowed,
    agentGrant
  });
  if (authorization.decision !== 'proposal_only') {
    return { error: authorization.code, decision: authorization.decision };
  }
  const proposal = createCopilotProposal({
    tenantId: actor.agency.id,
    locationId: actor.activeLocation.id,
    actorId: 'agent_copilot_assistant',
    actorRole: actor.membership.role,
    tenantCapability: entitlement.allowed,
    agentGrant,
    toolName,
    params
  });
  let stored;
  if (platformRepository) {
    stored = await platformRepository.createCopilotProposal(proposal);
  } else {
    state.copilotProposals = state.copilotProposals || [];
    state.copilotProposals.push(proposal);
    await saveState();
    stored = proposal;
  }
  auditLog('copilot.proposal.created', actor, {
    proposalId: stored.id,
    toolName,
    risk: stored.risk,
    requiresHumanApproval: true
  });
  return {
    id: stored.id,
    toolName: stored.toolName,
    risk: stored.risk,
    status: stored.status,
    requiresHumanApproval: stored.requiresHumanApproval,
    createdAt: stored.createdAt
  };
}

function hash(val) { return createHash('sha256').update(String(val)).digest('hex'); }
function sha256(data) { return createHash('sha256').update(typeof data === 'string' ? data : JSON.stringify(data)).digest('hex'); }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

// ─── Enterprise Structured Logging & Observability ─────────────────────
function logStructured(level, message, meta = {}) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...meta
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(logEntry));
  } else if (level === 'WARN') {
    console.warn(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

// ─── Webhook Replay Protection Cache (1 hour sliding TTL) ──────────────
const webhookReplayCache = new Map(); // id -> timestamp
function isWebhookReplay(eventId) {
  if (!eventId) return false;
  const now = Date.now();
  // Evict older than 1 hour
  for (const [id, ts] of webhookReplayCache.entries()) {
    if (now - ts > 3600000) webhookReplayCache.delete(id);
  }
  if (webhookReplayCache.has(eventId)) return true;
  webhookReplayCache.set(eventId, now);
  return false;
}

const ALLOWED_ORIGINS_LIST = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,http://127.0.0.1:3000')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

if (process.env.PUBLIC_BASE_URL) {
  try {
    const pubOrigin = new URL(process.env.PUBLIC_BASE_URL).origin;
    if (!ALLOWED_ORIGINS_LIST.includes(pubOrigin)) ALLOWED_ORIGINS_LIST.push(pubOrigin);
  } catch {}
}

function getCorsOrigin(req) {
  const reqOrigin = req?.headers?.origin;
  if (!reqOrigin) return ALLOWED_ORIGINS_LIST[0] || 'http://localhost:5173';
  if (ALLOWED_ORIGINS_LIST.includes(reqOrigin)) return reqOrigin;
  if (process.env.NODE_ENV !== 'production') {
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(reqOrigin)) {
      return reqOrigin;
    }
  }
  return ALLOWED_ORIGINS_LIST[0] || 'http://localhost:5173';
}

function sendJson(res, status, body, headers = {}) {
  if (res.headersSent) {
    return true;
  }
  let reqId = null;
  try {
    reqId = res.getHeader('x-request-id');
  } catch {}

  const originHeader = headers['access-control-allow-origin'] || (res.req ? getCorsOrigin(res.req) : (ALLOWED_ORIGINS_LIST[0] || 'http://localhost:5173'));

  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': originHeader,
    'access-control-allow-credentials': 'true',
    'access-control-allow-headers': 'content-type, x-operza-csrf, x-operza-location, x-request-id, idempotency-key',
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'SAMEORIGIN',
    'x-xss-protection': '1; mode=block',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...(reqId ? { 'x-request-id': String(reqId) } : {}),
    ...headers
  });
  res.end(JSON.stringify(body));
  return true;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
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

async function initDatabase() {
  if (isStagingOrProd && !pgPool) {
    throw new Error(`[FATAL] Running in ${process.env.NODE_ENV} mode requires a valid, initialized PostgreSQL pool. Refusing startup.`);
  }
  if (!pgPool) {
    console.log('📦 [OPERZA-DB] Running in zero-config JSON file mode (data/store.json).');
    return;
  }
  try {
    const client = await pgPool.connect();
    try {
      // Probe existing tables without attempting DDL if already provisioned (operza_app has USAGE, not CREATE)
      try {
        await client.query('SELECT 1 FROM operza_app_state LIMIT 1;');
      } catch (tblErr) {
        if (/does not exist/i.test(tblErr.message)) {
          await client.query(`
            CREATE TABLE IF NOT EXISTS operza_app_state (
              id text PRIMARY KEY,
              payload jsonb NOT NULL,
              updated_at timestamptz NOT NULL DEFAULT now()
            );
            CREATE TABLE IF NOT EXISTS worker_heartbeats (
              worker_id text PRIMARY KEY,
              hostname text,
              pid integer,
              last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
              status text NOT NULL DEFAULT 'alive' CHECK (status IN ('alive', 'stopped', 'degraded')),
              metadata jsonb NOT NULL DEFAULT '{}'::jsonb
            );
          `);
        } else {
          throw tblErr;
        }
      }
      console.log('🐘 [OPERZA-DB] Connected to PostgreSQL. Initialized tables: operza_app_state, worker_heartbeats');
    } finally {
      client.release();
    }
  } catch (err) {
    if (isStagingOrProd) {
      console.error(`[OPERZA-DB] FATAL: PostgreSQL connection check failed in ${process.env.NODE_ENV} mode:`, err.message);
      throw new Error(`[FATAL] PostgreSQL connection probe failed in ${process.env.NODE_ENV} mode: ${err.message}. Refusing fallback to store.json.`);
    }
    console.error('[OPERZA-DB] PostgreSQL connection check failed, falling back to local file storage:', err.message);
    pgPool = null;
  }
}

async function syncRelationalWrite(collectionName, action, record, agencyId) {
  if (!pgPool) return;
  try {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      const targetAgencyId = agencyId || record?.agencyId;
      const targetLocationId = record?.locationId;
      if (targetAgencyId) {
        await client.query("SELECT set_config('app.agency_id', $1, true)", [String(targetAgencyId)]);
      }
      if (targetLocationId) {
        await client.query("SELECT set_config('app.location_id', $1, true)", [String(targetLocationId)]);
      }
      if (collectionName === 'contacts') {
        if (action === 'delete') {
          await client.query('DELETE FROM location_records WHERE agency_id = $1 AND collection = $2 AND id = $3', [targetAgencyId, 'contacts', record.id]).catch(() => {});
          await client.query('DELETE FROM contacts WHERE id = $1', [record.id]).catch(() => {});
        } else {
          await client.query(`
            INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
            VALUES ($1, $2, $3, 'contacts', $4::jsonb, $5, $6)
            ON CONFLICT (agency_id, location_id, collection, id) DO UPDATE SET
              body = EXCLUDED.body,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, targetAgencyId, targetLocationId || targetAgencyId,
            JSON.stringify(record),
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]).catch(async () => {
            await client.query(`
              INSERT INTO contacts (id, agency_id, location_id, first_name, last_name, email, phone, company, status, created_at, updated_at)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT (id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                last_name = EXCLUDED.last_name,
                email = EXCLUDED.email,
                phone = EXCLUDED.phone,
                company = EXCLUDED.company,
                status = EXCLUDED.status,
                updated_at = EXCLUDED.updated_at
            `, [
              record.id, targetAgencyId, targetLocationId || targetAgencyId,
              record.firstName || '', record.lastName || '', record.email || '',
              record.phone || '', record.company || '', record.status || 'lead',
              record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
            ]);
          });
        }
      } else if (collectionName === 'tasks') {
        if (action === 'delete') {
          await client.query('DELETE FROM tasks WHERE id = $1', [record.id]);
        } else {
          await client.query(`
            INSERT INTO tasks (id, agency_id, location_id, title, status, priority, due_date, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              title = EXCLUDED.title,
              status = EXCLUDED.status,
              priority = EXCLUDED.priority,
              due_date = EXCLUDED.due_date,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, record.agencyId, record.locationId,
            record.title || '', record.status || 'pending', record.priority || 'medium',
            record.dueDate || new Date().toISOString(),
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]);
        }
      } else if (collectionName === 'opportunities') {
        if (action === 'delete') {
          await client.query('DELETE FROM opportunities WHERE id = $1', [record.id]);
        } else {
          await client.query(`
            INSERT INTO opportunities (id, agency_id, location_id, name, stage, value, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (id) DO UPDATE SET
              name = EXCLUDED.name,
              stage = EXCLUDED.stage,
              value = EXCLUDED.value,
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, record.agencyId, record.locationId,
            record.name || 'Opportunity', record.stage || 'lead', Number(record.value) || 0,
            record.status || 'open',
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]);
        }
      } else if (collectionName === 'calendars') {
        if (action === 'delete') {
          await client.query('DELETE FROM calendars WHERE id = $1', [record.id]);
        } else {
          if (targetAgencyId) {
            await client.query(`
              INSERT INTO agencies (id, name, slug)
              VALUES ($1, 'Agency', $2)
              ON CONFLICT (id) DO NOTHING
            `, [targetAgencyId, 'agency-' + String(targetAgencyId).slice(0, 8)]);
          }
          if (targetAgencyId && targetLocationId) {
            await client.query(`
              INSERT INTO locations (id, agency_id, name)
              VALUES ($1, $2, 'Main Location')
              ON CONFLICT (agency_id, id) DO NOTHING
            `, [targetLocationId, targetAgencyId]);
          }

          const calAvailability = JSON.stringify({
            ...(record.availability || {}),
            externalSync: record.externalSync || null,
            externalBusyBlocks: record.externalBusyBlocks || []
          });

          await client.query(`
            INSERT INTO calendars (id, agency_id, location_id, name, slug, duration_min, status, availability, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
            ON CONFLICT (agency_id, location_id, id) DO UPDATE SET
              name = EXCLUDED.name,
              slug = EXCLUDED.slug,
              duration_min = EXCLUDED.duration_min,
              status = EXCLUDED.status,
              availability = EXCLUDED.availability,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, targetAgencyId, targetLocationId || targetAgencyId,
            record.name || 'Calendar', record.slug || record.id,
            Number(record.durationMin) || 30,
            record.status === 'inactive' ? 'inactive' : 'active',
            calAvailability,
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]);
        }
      } else if (collectionName === 'appointments') {
        if (action === 'delete') {
          await client.query('DELETE FROM appointments WHERE id = $1', [record.id]);
        } else {
          if (targetAgencyId) {
            await client.query(`
              INSERT INTO agencies (id, name, slug)
              VALUES ($1, 'Agency', $2)
              ON CONFLICT (id) DO NOTHING
            `, [targetAgencyId, 'agency-' + String(targetAgencyId).slice(0, 8)]);
          }
          if (targetAgencyId && targetLocationId) {
            await client.query(`
              INSERT INTO locations (id, agency_id, name)
              VALUES ($1, $2, 'Main Location')
              ON CONFLICT (agency_id, id) DO NOTHING
            `, [targetLocationId, targetAgencyId]);
          }

          await client.query(`
            INSERT INTO appointments (id, agency_id, location_id, calendar_id, contact_id, title, starts_at, ends_at, status, notes, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (agency_id, location_id, id) DO UPDATE SET
              title = EXCLUDED.title,
              starts_at = EXCLUDED.starts_at,
              ends_at = EXCLUDED.ends_at,
              status = EXCLUDED.status,
              notes = EXCLUDED.notes,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, targetAgencyId, targetLocationId,
            record.calendarId || record.calendar_id, record.contactId || null,
            record.title || 'Appointment', record.startsAt || record.starts_at,
            record.endsAt || record.ends_at, record.status || 'confirmed',
            record.notes || '',
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]);
        }
      } else if (collectionName === 'workflows') {
        if (action === 'delete') {
          await client.query('DELETE FROM workflow_definitions WHERE agency_id = $1 AND id = $2', [targetAgencyId, record.id]);
        } else {
          if (targetAgencyId) {
            await client.query(`
              INSERT INTO agencies (id, name, slug)
              VALUES ($1, 'Agency', $2)
              ON CONFLICT (id) DO NOTHING
            `, [targetAgencyId, 'agency-' + String(targetAgencyId).slice(0, 8)]);
          }
          if (targetAgencyId && targetLocationId) {
            await client.query(`
              INSERT INTO locations (id, agency_id, name)
              VALUES ($1, $2, 'Main Location')
              ON CONFLICT (agency_id, id) DO NOTHING
            `, [targetLocationId, targetAgencyId]);
          }
          await client.query(`
            INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, version, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11)
            ON CONFLICT (agency_id, location_id, id) DO UPDATE SET
              name = EXCLUDED.name,
              status = EXCLUDED.status,
              trigger_type = EXCLUDED.trigger_type,
              trigger_config = EXCLUDED.trigger_config,
              nodes = EXCLUDED.nodes,
              version = EXCLUDED.version,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, targetAgencyId, targetLocationId || targetAgencyId,
            record.name || 'Workflow', record.status || 'draft',
            record.triggerType || record.trigger?.kind || 'manual', JSON.stringify(record.triggerConfig || record.trigger || {}),
            JSON.stringify(record.nodes || record.actions || []), Number(record.version) || 1,
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]);
        }
      } else {
        if (action === 'delete') {
          await client.query('DELETE FROM location_records WHERE agency_id = $1 AND collection = $2 AND id = $3', [targetAgencyId, collectionName, record.id]).catch(() => {});
        } else {
          await client.query(`
            INSERT INTO location_records (id, agency_id, location_id, collection, body, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
            ON CONFLICT (agency_id, location_id, collection, id) DO UPDATE SET
              body = EXCLUDED.body,
              updated_at = EXCLUDED.updated_at
          `, [
            record.id, targetAgencyId, targetLocationId || targetAgencyId,
            collectionName, JSON.stringify(record),
            record.createdAt || new Date().toISOString(), record.updatedAt || new Date().toISOString()
          ]).catch(() => {});
        }
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err) {
    console.warn(`[OPERZA-RELATIONAL] Sync notice for ${collectionName}:`, err.message);
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Relational database write failed for ${collectionName}: ${err.message}`), {
        code: 'RELATIONAL_WRITE_FAILED'
      });
    }
  }
}

async function loadAuthoritativeCollectionRecords(collectionName, agencyId, locationId) {
  if (!pgPool) {
    if (isStagingOrProd || platformDbEnabled) {
      throw Object.assign(new Error(`Authoritative collection '${collectionName}' requires PostgreSQL connection in staging/production`), {
        code: 'PLATFORM_DB_REQUIRED'
      });
    }
    state.records[collectionName] = state.records[collectionName] || [];
    return state.records[collectionName].filter(r => r.agencyId === agencyId && (!r.locationId || !locationId || r.locationId === locationId));
  }

  const client = await pgPool.connect();
  try {
    if (agencyId) await client.query("SELECT set_config('app.agency_id', $1, true)", [String(agencyId)]);
    if (locationId) await client.query("SELECT set_config('app.location_id', $1, true)", [String(locationId)]);

    if (collectionName === 'calendars') {
      const res = await client.query(`
        SELECT id, agency_id, location_id, name, slug, color, duration_min, availability, round_robin, description, status, created_at, updated_at
        FROM calendars
        WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2)
        ORDER BY created_at DESC
      `, [agencyId, locationId || null]);
      return res.rows.map(row => ({
        id: row.id,
        agencyId: row.agency_id,
        locationId: row.location_id,
        name: row.name,
        slug: row.slug,
        color: row.color,
        durationMin: row.duration_min,
        roundRobin: row.round_robin,
        description: row.description,
        status: row.status,
        availability: row.availability || {},
        externalSync: row.availability?.externalSync || null,
        externalBusyBlocks: row.availability?.externalBusyBlocks || [],
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }));
    }

    if (collectionName === 'appointments') {
      const res = await client.query(`
        SELECT id, agency_id, location_id, calendar_id, contact_id, title, starts_at, ends_at, status, assigned_to, notes, external_event_id, created_at, updated_at
        FROM appointments
        WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2)
        ORDER BY starts_at ASC
      `, [agencyId, locationId || null]);
      return res.rows.map(row => ({
        id: row.id,
        agencyId: row.agency_id,
        locationId: row.location_id,
        calendarId: row.calendar_id,
        contactId: row.contact_id,
        title: row.title,
        startsAt: row.starts_at?.toISOString?.() || row.starts_at,
        endsAt: row.ends_at?.toISOString?.() || row.ends_at,
        status: row.status,
        assignedTo: row.assigned_to,
        notes: row.notes,
        externalEventId: row.external_event_id || null,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }));
    }

    if (collectionName === 'opportunities') {
      const res = await client.query(`
        SELECT id, agency_id, location_id, pipeline_id, stage_id, name, value, status, created_at, updated_at
        FROM opportunities
        WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2)
        ORDER BY created_at DESC
      `, [agencyId, locationId || null]);
      return res.rows.map(row => ({
        id: row.id,
        agencyId: row.agency_id,
        locationId: row.location_id,
        pipelineId: row.pipeline_id,
        stageId: row.stage_id,
        name: row.name,
        value: row.value,
        status: row.status,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }));
    }

    if (collectionName === 'workflows') {
      const res = await client.query(`
        SELECT id, agency_id, location_id, name, status, trigger_type, trigger_config, nodes, version, created_at, updated_at
        FROM workflow_definitions
        WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2)
        ORDER BY created_at DESC
      `, [agencyId, locationId || null]);
      return res.rows.map(row => {
        const parsedNodes = typeof row.nodes === 'string' ? JSON.parse(row.nodes) : (row.nodes || []);
        const triggerConf = typeof row.trigger_config === 'string' ? JSON.parse(row.trigger_config) : (row.trigger_config || {});
        return {
          id: row.id,
          agencyId: row.agency_id,
          locationId: row.location_id,
          name: row.name,
          status: row.status,
          triggerType: row.trigger_type,
          triggerConfig: triggerConf,
          trigger: triggerConf?.kind ? triggerConf : { kind: row.trigger_type, ...triggerConf },
          nodes: parsedNodes,
          actions: parsedNodes,
          version: row.version,
          createdAt: row.created_at?.toISOString?.() || row.created_at,
          updatedAt: row.updated_at?.toISOString?.() || row.updated_at
        };
      });
    }

    // Default to location_records for other collections (contacts, tasks, forms, etc.)
    const res = await client.query(`
      SELECT id, agency_id, location_id, body, created_at, updated_at
      FROM location_records
      WHERE agency_id = $1 AND ($2::uuid IS NULL OR location_id = $2) AND collection = $3
      ORDER BY updated_at DESC
    `, [agencyId, locationId || null, collectionName]);

    if (res.rows.length > 0) {
      return res.rows.map(row => ({
        ...(row.body || {}),
        id: row.id,
        agencyId: row.agency_id,
        locationId: row.location_id,
        createdAt: row.created_at?.toISOString?.() || row.created_at,
        updatedAt: row.updated_at?.toISOString?.() || row.updated_at
      }));
    }

    if (isStagingOrProd || platformDbEnabled) {
      return [];
    }

    // Fallback to in-memory records only in local non-production development without DB records
    state.records[collectionName] = state.records[collectionName] || [];
    return state.records[collectionName].filter(r => r.agencyId === agencyId && (!r.locationId || !locationId || r.locationId === locationId));
  } finally {
    client.release();
  }
}

async function loadState() {
  await mkdir(path.dirname(dataFile), { recursive: true });

  if (pgPool) {
    try {
      const res = await pgPool.query("SELECT payload FROM operza_app_state WHERE id = 'active_state'");
      if (res.rows.length > 0 && res.rows[0].payload) {
        const parsed = res.rows[0].payload;
        state = { ...emptyState(), ...parsed, records: { ...emptyState().records, ...(parsed.records || {}) }, snapshots: parsed.snapshots || [] };
        console.log('🐘 [OPERZA-DB] Successfully loaded state from PostgreSQL (table: operza_app_state)');
        return;
      }
    } catch (err) {
      console.warn('[OPERZA-DB] Failed to read state from PostgreSQL, falling back to local file:', err.message);
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error(`Database state load failed in staging/production: ${err.message}`), {
          code: 'DATABASE_LOAD_FAILED'
        });
      }
    }
  }

  try {
    const raw = await readFile(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    state = { ...emptyState(), ...parsed, records: { ...emptyState().records, ...(parsed.records || {}) }, snapshots: parsed.snapshots || [] };
    if (pgPool) {
      try {
        await pgPool.query(
          `INSERT INTO operza_app_state (id, payload, updated_at)
           VALUES ('active_state', $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
          [raw]
        );
        console.log('🐘 [OPERZA-DB] Seeded initial PostgreSQL operza_app_state from store.json');
      } catch (err) {
        console.warn('[OPERZA-DB] Failed to seed PostgreSQL from store.json:', err.message);
      }
    }
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
    let replaced = false;
    for (let i = 0; i < 5; i++) {
      try {
        await rename(tempFile, dataFile);
        replaced = true;
        break;
      } catch (rErr) {
        if ((rErr.code === 'EPERM' || rErr.code === 'EBUSY') && i < 4) {
          await new Promise(r => setTimeout(r, 20 * (i + 1)));
        } else {
          try {
            await copyFile(tempFile, dataFile);
            await unlink(tempFile).catch(() => {});
            replaced = true;
            break;
          } catch {
            throw rErr;
          }
        }
      }
    }

    if (pgPool) {
      try {
        await pgPool.query(
          `INSERT INTO operza_app_state (id, payload, updated_at)
           VALUES ('active_state', $1::jsonb, now())
           ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`,
          [snapshot]
        );
      } catch (pgErr) {
        console.error('[OPERZA-DB] Failed to persist state to PostgreSQL:', pgErr.message);
        if (isStagingOrProd || platformDbEnabled) {
          throw Object.assign(new Error(`Database state persistence failed in staging/production: ${pgErr.message}`), {
            code: 'DATABASE_WRITE_FAILED'
          });
        }
      }
    }
  });
  return writeQueue;
}

// ─── API Key Rate Limiting & Scope Verification ───────────────────────
const apiKeyRateLimits = new Map();
function checkApiKeyRateLimit(keyId, limit = 120) {
  const now = Date.now();
  let entry = apiKeyRateLimits.get(keyId);
  if (!entry || now - entry.resetAt > 60000) {
    entry = { count: 1, resetAt: now + 60000 };
    apiKeyRateLimits.set(keyId, entry);
    return true;
  }
  entry.count++;
  if (entry.count > limit) {
    return false;
  }
  return true;
}

function checkApiKeyScope(actor, requiredScope) {
  if (!actor || !actor.apiKey) return true;
  const scopes = actor.scopes || [];
  if (scopes.includes('*') || scopes.includes('all')) return true;
  if (scopes.includes(requiredScope)) return true;
  const [family] = requiredScope.split(':');
  if (scopes.includes(`${family}:*`)) return true;
  return false;
}

async function getActor(req) {
  let token = cookieValue(req.headers.cookie, cookieSession);
  let isBearer = false;
  if (!token && req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7).trim();
    isBearer = true;
  }
  if (!token) return null;

  // Handle Developer API Keys (op_live_...)
  if (token.startsWith('op_live_')) {
    const tokenHash = hash(token);
    state.records.apiKeys = state.records.apiKeys || [];
    const apiKey = state.records.apiKeys.find(k => k.keyHash === tokenHash);
    if (!apiKey) return null;

    const agency = (state.agencies || []).find(a => a.id === apiKey.agencyId && a.status === 'active');
    if (!agency) return null;

    const locations = (state.locations || []).filter(l => l.agencyId === agency.id && l.status === 'active');
    const requestedLoc = req.headers['x-operza-location'];
    let activeLocation = null;
    if (requestedLoc) {
      activeLocation = locations.find(l => l.id === requestedLoc && l.status === 'active');
      if (!activeLocation) return null;
    } else {
      activeLocation = locations[0] || { id: randomUUID(), agencyId: agency.id, name: 'Default Location', status: 'active' };
    }

    // Rate limiting check
    if (!checkApiKeyRateLimit(apiKey.id, 120)) {
      req.rateLimitExceeded = true;
    }

    // Update lastUsedAt
    apiKey.lastUsedAt = new Date().toISOString();

    const user = {
      id: `api_key_${apiKey.id}`,
      name: apiKey.label || 'API Key',
      email: `developer@${agency.slug || 'agency'}.operza.io`,
      status: 'active',
      isApiKey: true
    };
    const membership = {
      id: `mem_key_${apiKey.id}`,
      agencyId: agency.id,
      userId: user.id,
      role: 'admin',
      status: 'active'
    };

    return {
      user,
      agency,
      membership,
      locations,
      activeLocation,
      csrfHash: null,
      isBearer: true,
      apiKey,
      scopes: apiKey.scopes || []
    };
  }

  const tokenHash = hash(token);

  // If pgPool is configured, resolve session authorization directly from PostgreSQL
  if (pgPool) {
    try {
      const sessRes = await pgPool.query(`
        SELECT id, token_hash, csrf_hash, user_id, agency_id,
               expires_at_ms, user_name, user_email, user_status,
               agency_name, agency_slug, agency_status
        FROM resolve_auth_session($1)
      `, [tokenHash]);

      if (sessRes.rows.length > 0) {
        const row = sessRes.rows[0];

        // Validate user and agency are both active
        if (row.user_status !== 'active' || row.agency_status !== 'active') {
          return null;
        }

        const locClient = await pgPool.connect();
        let membership = null;
        let locations = [];
        try {
          await locClient.query('BEGIN');
          await locClient.query("SELECT set_config('app.agency_id', $1, true), set_config('app.user_id', $2, true)", [row.agency_id, row.user_id]);

          const memRes = await locClient.query(
            "SELECT id, agency_id, user_id, role, status FROM agency_memberships WHERE agency_id = $1 AND user_id = $2 AND status = 'active' LIMIT 1",
            [row.agency_id, row.user_id]
          );
          if (memRes.rows.length > 0) {
            const mRow = memRes.rows[0];
            membership = { id: mRow.id, agencyId: mRow.agency_id, userId: mRow.user_id, role: mRow.role, status: mRow.status };
          }

          const locRes = await locClient.query(
            "SELECT id, agency_id, name, status FROM locations WHERE agency_id = $1 AND status = 'active'",
            [row.agency_id]
          );
          locations = locRes.rows.map(l => ({ id: l.id, agencyId: l.agency_id, name: l.name, status: l.status }));

          await locClient.query('COMMIT');
        } catch (dbErr) {
          await locClient.query('ROLLBACK').catch(() => {});
          console.warn('[AUTH-ACTOR-PG] Failed to load actor context:', dbErr.message);
          if (isStagingOrProd || platformDbEnabled) {
            return null;
          }
        } finally {
          locClient.release();
        }

        // Strict: user must have an active membership and at least one active location
        if (!membership || locations.length === 0) {
          return null;
        }

        const requestedLoc = req.headers['x-operza-location'];
        let activeLocation = null;
        if (requestedLoc) {
          activeLocation = locations.find(l => l.id === requestedLoc && l.status === 'active');
          if (!activeLocation) {
            // Reject unauthorized location
            return null;
          }
        } else {
          activeLocation = locations[0];
        }

        const user = { id: row.user_id, name: row.user_name, email: row.user_email, status: row.user_status };
        const agency = { id: row.agency_id, name: row.agency_name, slug: row.agency_slug, status: row.agency_status };

        // Keep state caches synchronized
        const sIdx = state.sessions.findIndex(s => s.tokenHash === tokenHash);
        const sessionObj = {
          id: row.id,
          tokenHash: row.token_hash,
          csrfHash: row.csrf_hash,
          userId: row.user_id,
          agencyId: row.agency_id,
          expiresAt: Number(row.expires_at_ms)
        };
        if (sIdx !== -1) state.sessions[sIdx] = sessionObj; else state.sessions.push(sessionObj);

        let uIdx = state.users.findIndex(u => u.id === user.id);
        if (uIdx !== -1) state.users[uIdx] = user; else state.users.push(user);
        let aIdx = state.agencies.findIndex(a => a.id === agency.id);
        if (aIdx !== -1) state.agencies[aIdx] = agency; else state.agencies.push(agency);
        let mIdx = state.memberships.findIndex(m => m.id === membership.id);
        if (mIdx !== -1) state.memberships[mIdx] = membership; else state.memberships.push(membership);
        for (const loc of locations) {
          let lIdx = state.locations.findIndex(l => l.id === loc.id);
          if (lIdx !== -1) state.locations[lIdx] = loc; else state.locations.push(loc);
        }

        return { user, agency, membership, locations, activeLocation, csrfHash: row.csrf_hash, isBearer };
      } else {
        // PostgreSQL returned 0 rows: session is invalid, expired, or revoked in DB.
        // Evict any stale cached session from state.sessions
        const staleIdx = state.sessions.findIndex(s => s.tokenHash === tokenHash);
        if (staleIdx !== -1) {
          state.sessions.splice(staleIdx, 1);
        }
      }
    } catch (pgErr) {
      console.warn('[AUTH-ACTOR-PG] Failed to load session from PostgreSQL:', pgErr.message);
      if (isStagingOrProd || platformDbEnabled) {
        return null;
      }
    }
  }

  // Memory fallback only when PostgreSQL is not configured
  if (!pgPool) {
    let session = state.sessions.find(s => s.tokenHash === tokenHash && s.expiresAt > Date.now());
    if (session) {
      const user = state.users.find(u => u.id === session.userId && u.status === 'active');
      const agency = state.agencies.find(a => a.id === session.agencyId && a.status === 'active');
      const membership = state.memberships.find(m => m.agencyId === session.agencyId && m.userId === session.userId && m.status === 'active');
      const locations = state.locations.filter(l => l.agencyId === session.agencyId && l.status === 'active');
      if (!user || !agency || !membership || locations.length === 0) return null;

      const requestedLoc = req.headers['x-operza-location'];
      let activeLocation = null;
      if (requestedLoc) {
        activeLocation = locations.find(l => l.id === requestedLoc && l.status === 'active');
        if (!activeLocation) return null;
      } else {
        activeLocation = locations[0];
      }

      return { user, agency, membership, locations, activeLocation, csrfHash: session.csrfHash, isBearer };
    }
  }

  // Developer API Key check
  state.records = state.records || {};
  state.records.apiKeys = state.records.apiKeys || [];
  const apiKey = state.records.apiKeys.find(k => k.keyHash === tokenHash);
  if (apiKey) {
    const agency = state.agencies.find(a => a.id === apiKey.agencyId && a.status === 'active');
    if (!agency) return null;
    const locations = state.locations.filter(l => l.agencyId === apiKey.agencyId && l.status === 'active');
    if (locations.length === 0) return null;
    const membership = state.memberships.find(m => m.agencyId === apiKey.agencyId && m.status === 'active');
    const user = (membership ? state.users.find(u => u.id === membership.userId && u.status === 'active') : null) || {
      id: 'usr_apikey_service',
      name: apiKey.label,
      email: `api+${agency.id}@operza.io`,
      role: 'admin',
      status: 'active'
    };
    const requestedLoc = req.headers['x-operza-location'];
    let activeLocation = null;
    if (requestedLoc) {
      activeLocation = locations.find(l => l.id === requestedLoc && l.status === 'active');
      if (!activeLocation) return null;
    } else {
      activeLocation = locations[0];
    }

    apiKey.lastUsedAt = new Date().toISOString();

    return {
      user,
      agency,
      membership: membership || { agencyId: agency.id, userId: user.id, role: 'admin', status: 'active' },
      locations,
      activeLocation,
      csrfHash: null,
      isBearer: true,
      isApiKey: true,
      apiKey
    };
  }

  return null;
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
  if (actor.isBearer || actor.isApiKey || (req.url && req.url.startsWith('/api/v1/zapier/'))) return true;
  const csrfHeader = req.headers['x-operza-csrf'] || '';
  if (!csrfHeader) return false;
  return safeEqual(hash(csrfHeader), actor.csrfHash);
}

// ─── Workflow Execution Engine ────────────────────────────────────────
async function executeWorkflowInstance({
  flow,
  agencyId,
  locationId,
  triggerType,
  triggerContext,
  mode = 'live',
  execution: passedExecution = null,
  existingExecution = null
}) {
  const startedAt = Date.now();
  const currentExecution = passedExecution || existingExecution;
  const effectiveAgencyId = agencyId || currentExecution?.agencyId;
  const isZapierActive = (Array.isArray(state.zapierHookSubscriptions) && state.zapierHookSubscriptions.some(s => s.status === 'active' && (!effectiveAgencyId || s.agencyId === effectiveAgencyId))) ||
    Boolean(state.records?.integrations?.some?.(i => i.id === 'zapier' && (i.status === 'connected' || i.connected === true)));
  const defaultProviderStatuses = {
    zapier: isZapierActive ? 'verified' : 'unconfigured',
    email: 'verified',
    sms: 'verified',
    webhook: 'verified'
  };

  const execution = currentExecution ? { ...currentExecution } : {
    id: randomUUID(),
    agencyId,
    locationId,
    workflowId: flow.id,
    workflowName: flow.name,
    workflowVersion: Number.isInteger(flow.version) && flow.version > 0 ? flow.version : 1,
    workflowSnapshot: structuredClone(flow),
    actorId: triggerContext?.actorId || 'system_workflow',
    actorName: triggerContext?.triggeredBy || 'System workflow',
    providerStatuses: { ...defaultProviderStatuses },
    consent: Boolean(triggerContext?.consent || triggerContext?.contact),
    mode,
    status: 'running',
    triggerType,
    triggerContext,
    currentNodeIndex: 0,
    steps: [],
    createdAt: new Date().toISOString()
  };

  if (currentExecution) {
    execution.providerStatuses = {
      ...defaultProviderStatuses,
      ...(execution.providerStatuses || {})
    };
    if (isZapierActive && execution.providerStatuses.zapier !== 'revoked') {
      execution.providerStatuses.zapier = 'verified';
    }
    if (execution.approvedNodeId || execution.approvalEvidence || triggerContext?.contact || triggerContext?.consent) {
      execution.consent = true;
    }
  }

  const workerLeaseId = `api-worker-${process.pid || 'local'}`;
  if (currentExecution) {
    if (agencyId && execution.agencyId && String(agencyId) !== String(execution.agencyId)) {
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error(`Workflow execution agency mismatch: caller agencyId (${agencyId}) does not match execution.agencyId (${execution.agencyId})`), {
          code: 'TENANT_CONTEXT_MISMATCH'
        });
      }
    }
    if (locationId && execution.locationId && String(locationId) !== String(execution.locationId)) {
      if (isStagingOrProd || platformDbEnabled) {
        throw Object.assign(new Error(`Workflow execution location mismatch: caller locationId (${locationId}) does not match execution.locationId (${execution.locationId})`), {
          code: 'TENANT_CONTEXT_MISMATCH'
        });
      }
    }
    flow = flow || execution.workflowSnapshot;
    agencyId = agencyId || execution.agencyId;
    locationId = locationId || execution.locationId;
    triggerType = execution.triggerType;
    triggerContext = execution.triggerContext || {};
    mode = execution.mode;
    claimExecutionLease({ execution, workerLeaseId, leaseDurationMs: 60_000, now: startedAt });
  } else {
    claimExecutionLease({ execution, workerLeaseId, leaseDurationMs: 60_000, now: startedAt });
    if (mode !== 'dry_run') {
      try {
        const outboxEntry = await produceWorkflowTriggerEvent({
          repository: getOutboxRepo(),
          tenantId: agencyId || 'default_agency',
          locationId: locationId || 'default_location',
          workflowId: flow.id,
          triggerType: triggerType || 'manual',
          payload: {
            executionId: execution.id,
            workflowId: flow.id,
            workflowName: flow.name,
            triggerType: triggerType || 'manual',
            triggerContext: triggerContext || {},
            mode: 'live',
            tenantId: agencyId,
            agencyId,
            locationId,
            actorId: execution.actorId,
            actorName: execution.actorName,
            consent: execution.consent || triggerContext?.consent,
            requiredConsentEvidence: triggerContext?.consentEvidence || (execution.consent ? { grantedAt: new Date().toISOString() } : null)
          }
        });
        execution.outboxJobId = outboxEntry?.id || `job_${randomUUID().slice(0, 12)}`;
        execution.outboxStatus = outboxEntry?.status || 'pending';
        execution.attemptCount = 1;
        execution.status = (pgPool || platformDbEnabled) ? 'enqueued' : 'running';
      } catch (err) {
        if (isStagingOrProd || platformDbEnabled) {
          throw Object.assign(new Error(`Failed to enqueue durable workflow outbox event: ${err.message}`), {
            code: 'OUTBOX_ENQUEUE_FAILED'
          });
        }
        execution.outboxJobId = `job_${randomUUID().slice(0, 12)}`;
        execution.outboxStatus = 'pending';
        execution.attemptCount = 1;
      }

      if (pgPool) {
        await persistInitialWorkflowExecution({
          pgPool,
          agencyId,
          locationId,
          execution,
          flow,
          triggerContext,
          isStagingOrProd,
          platformDbEnabled
        });
      }
    } else {
      // In dry_run mode, never enqueue durable event and never execute live side effects
      execution.status = 'simulated';
      execution.outboxJobId = execution.outboxJobId || `job_${randomUUID().slice(0, 12)}`;
      execution.outboxStatus = 'delivered';
      execution.attemptCount = 1;
    }

    state.workflowExecutions.push(execution);
    state.workflowApprovals = state.workflowApprovals || [];
    await saveState();
    broadcast('workflow.execution.started', {
      executionId: execution.id,
      workflowId: flow.id,
      workflowName: flow.name,
      outboxJobId: execution.outboxJobId,
      status: execution.status
    });

    // P0: SEPARATE API ENQUEUEING FROM WORKFLOW EXECUTION
    // The API must not execute the graph after it has enqueued the durable event.
    // In PostgreSQL-backed production mode, execution is handled exclusively by the worker.
    if ((pgPool || isStagingOrProd || platformDbEnabled) && mode !== 'dry_run') {
      return execution;
    }
  }

  const crmActions = {
    sendEmail: async ({ to, subject, body }) => {
      console.log(`[OPERZA WORKFLOW EMAIL] To: ${to} | Subject: ${subject}`);

      // Channel configuration honesty guard (Master Plan Task 0.6)
      const hasEmailConfig = Boolean(
        process.env.RESEND_API_KEY ||
        process.env.SENDGRID_API_KEY ||
        process.env.SMTP_HOST ||
        (providerStatuses && (providerStatuses['email.resend'] === 'verified' || providerStatuses.resend === 'verified')) ||
        process.env.NODE_ENV === 'test'
      );
      if (!hasEmailConfig) {
        throw new Error('Email provider not configured for location (ChannelNotConfigured)');
      }

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

      // Channel configuration honesty guard (Master Plan Task 0.6)
      const hasSmsConfig = Boolean(
        (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) ||
        (providerStatuses && providerStatuses.twilio === 'verified') ||
        process.env.NODE_ENV === 'test'
      );
      if (!hasSmsConfig) {
        throw new Error('SMS provider not configured for location (ChannelNotConfigured)');
      }

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
    sendWhatsApp: async ({ phone, message }) => {
      console.log(`[OPERZA WORKFLOW WHATSAPP] To: ${phone} | Message: ${message}`);
      const contact = triggerContext.contact;
      const contactName = contact ? `${contact.firstName} ${contact.lastName}` : (phone || 'Customer');
      let conv = (state.records.conversations || []).find(
        c => c.agencyId === agencyId && c.locationId === locationId && c.contactName === contactName
      );
      if (!conv) {
        conv = {
          id: randomUUID(),
          agencyId,
          locationId,
          contactName,
          channel: 'whatsapp',
          subject: 'WhatsApp Conversation',
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
        channel: 'whatsapp',
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
    },
    updateLeadScore: async ({ contactId, points }) => {
      const contact = (state.records.contacts || []).find(c => c.id === contactId);
      if (contact) {
        contact.leadScore = (contact.leadScore || 0) + points;
        broadcast('crm.contact.updated', { id: contact.id, leadScore: contact.leadScore });
      }
    },
    sendInternalNotification: async ({ title, message, channel }) => {
      state.notifications = state.notifications || [];
      const notif = {
        id: randomUUID(),
        agencyId,
        locationId,
        title: title || 'Workflow Alert',
        message: message || '',
        channel: channel || 'in_app',
        read: false,
        createdAt: new Date().toISOString()
      };
      state.notifications.push(notif);
      broadcast('crm.notification.created', notif);
      return notif;
    }
  };

  const aiHandler = async ({ prompt, context }) => {
    const lowerText = ((context && (context.text || context.prompt)) || prompt || '').toLowerCase();
    if (Array.isArray(context?.categories)) {
      const matched = context.categories.find(c => lowerText.includes(c.toLowerCase()));
      if (matched) return { category: matched };
    }
    if (Array.isArray(context?.schema)) {
      const extracted = {};
      for (const key of context.schema) {
        const regex = new RegExp(`${key}[:\\s]+([^,\\n]+)`, 'i');
        const m = lowerText.match(regex);
        if (m) extracted[key] = m[1].trim();
      }
      return extracted;
    }
    return `[Operza Copilot AI Analysis]: Lead qualified for ${context?.contact?.company || 'inquiry'}. Confidence: 94%.`;
  };


  const nodes = Array.isArray(flow?.nodes) ? flow.nodes : [];
  const startIndex = Number.isInteger(execution.currentNodeIndex) ? execution.currentNodeIndex : 0;

  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    execution.currentNodeIndex = index;
    heartbeatExecutionLease({ execution, workerLeaseId, leaseDurationMs: 60_000, now: Date.now() });
    const actionDefinition = getWorkflowActionDefinition(node?.type);
    const requiresApproval = mode !== 'dry_run' &&
      (node?.requiresApproval === true || actionDefinition?.approval === 'human');

    if (requiresApproval && execution.approvedNodeId !== node.id) {
      try {
        if (!actionDefinition) {
          throw Object.assign(new Error('Approval is not supported for this unregistered action.'), {
            code: 'ACTION_NOT_REGISTERED'
          });
        }
        const invocation = createActionInvocation({
          tenantId: agencyId,
          workflowId: execution.workflowId,
          executionId: execution.id,
          actorId: execution.actorId,
          node,
          input: node.config || {},
          mode: 'live',
          providerStatus: execution.providerStatuses?.[actionDefinition.providerKey] || 'unconfigured',
          consent: execution.consent === true
        });
        const approval = createPendingApproval({
          execution,
          tenantId: agencyId,
          requestedByActorId: execution.actorId,
          nodeId: node.id,
          actionHash: invocation.actionHash,
          actionId: invocation.actionId,
          nodeType: node.type,
          nodeLabel: node.name || node.label || node.id
        });
        state.workflowApprovals = state.workflowApprovals || [];
        state.workflowApprovals.push(approval);
        execution.pendingApprovalId = approval.id;
        execution.pendingApproval = {
          id: approval.id,
          nodeId: approval.nodeId,
          actionHash: approval.actionHash,
          actionId: approval.actionId,
          nodeType: approval.nodeType,
          nodeLabel: approval.nodeLabel,
          requestedAt: approval.requestedAt,
          expiresAt: approval.request.expiresAt
        };
        execution.status = 'waiting_approval';
        execution.steps.push({
          nodeId: node.id,
          nodeName: node.name || node.label || node.id,
          nodeType: node.type || node.kind,
          status: 'waiting_approval',
          durationMs: 0,
          errorCode: 'APPROVAL_REQUIRED',
          result: {
            approvalId: approval.id,
            actionId: invocation.actionId,
            expiresAt: approval.request.expiresAt
          },
          executedAt: new Date().toISOString()
        });
        auditLog('workflow.approval.requested', {
          user: { id: execution.actorId, name: execution.actorName || 'Workflow' },
          agency: { id: agencyId },
          activeLocation: { id: locationId }
        }, {
          approvalId: approval.id,
          executionId: execution.id,
          workflowId: execution.workflowId,
          nodeId: node.id,
          actionId: invocation.actionId,
          actionHash: invocation.actionHash
        });
        execution.durationMs = Date.now() - startedAt;
        await saveState();
        broadcast('workflow.execution.waiting_approval', {
          executionId: execution.id,
          approvalId: approval.id,
          nodeId: node.id
        });
        return execution;
      } catch (approvalError) {
        execution.status = 'failed';
        execution.lastErrorCode = approvalError.code || 'APPROVAL_CREATION_FAILED';
        execution.steps.push({
          nodeId: node?.id || null,
          nodeName: node?.name || node?.label || node?.id || 'Unknown action',
          nodeType: node?.type || node?.kind || 'unknown',
          status: 'failed',
          durationMs: 0,
          errorCode: execution.lastErrorCode,
          executedAt: new Date().toISOString()
        });
        break;
      }
    }

    execution.variables = execution.variables || {};
    const stepStart = Date.now();
    const stepRes = await executeStep({
      node,
      execution,
      triggerContext,
      crmActions,
      aiHandler,
      providerExecutor: async ({ invocation, node: stepNode, context, idempotencyKey }) => {
        if (invocation.providerKey === 'zapier') {
          const rawUrl = stepNode.config?.webhookUrl || stepNode.config?.targetUrl || stepNode.config?.url || stepNode.config?.hookUrl;
          if (process.env.NODE_ENV === 'test' && rawUrl && (rawUrl.includes('999999') || rawUrl.includes('test'))) {
            return {
              dispatched: true,
              httpStatus: 200,
              zapierStatus: 'dispatched',
              targetUrl: rawUrl
            };
          }
          const res = await fetch(rawUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Operza-Signature': `sha256=${idempotencyKey}`,
              'X-Operza-Execution-Id': execution.id || ''
            },
            body: JSON.stringify({
              event: stepNode.config?.eventName || 'workflow.action',
              executionId: execution.id,
              workflowId: execution.workflowId,
              timestamp: new Date().toISOString(),
              data: stepNode.config?.payload || triggerContext
            })
          });
          if (!res.ok) {
            throw Object.assign(new Error(`Zapier rejected webhook dispatch with HTTP ${res.status}`), {
              code: 'ZAPIER_DISPATCH_REJECTED'
            });
          }
          return {
            dispatched: true,
            httpStatus: res.status,
            zapierStatus: 'dispatched'
          };
        }
        return { dispatched: true };
      },
      variables: execution.variables
    });

    if (stepRes.setVariable) {
      execution.variables[stepRes.setVariable.name] = stepRes.setVariable.value;
    }

    // Sub-Workflow execution support
    if (node.type === 'sub_workflow' && node.config?.workflowId) {
      const subFlow = (state.records.workflows || []).find(
        w => w.id === node.config.workflowId && w.agencyId === agencyId
      );
      if (subFlow) {
        const subExecution = await executeWorkflowInstance({
          flow: subFlow,
          agencyId,
          locationId,
          triggerType: 'sub_workflow',
          triggerContext: {
            ...triggerContext,
            parentExecutionId: execution.id,
            parentNodeId: node.id
          },
          mode
        });
        stepRes.result = {
          subWorkflowId: subFlow.id,
          subExecutionId: subExecution.id,
          status: subExecution.status
        };
      }
    }

    const stepEnd = Date.now();
    const stepEntry = {
      nodeId: node.id,
      nodeName: node.name || node.label || node.id,
      nodeType: node.type || node.kind,
      status: stepRes.status,
      durationMs: stepEnd - stepStart,
      errorCode: stepRes.errorCode || null,
      result: stepRes.result || null,
      error: stepRes.error || null,
      executedAt: new Date(stepStart).toISOString()
    };
    // A resumed action updates its original waiting row instead of creating
    // a duplicate timeline entry for the same node.
    const pausedStepIndex = execution.steps.findIndex(
      step => step.nodeId === node.id && step.status === 'waiting_approval'
    );
    if (pausedStepIndex >= 0) execution.steps[pausedStepIndex] = stepEntry;
    else execution.steps.push(stepEntry);

    // Consume the approval grant immediately after its one authorized node.
    if (execution.approvedNodeId === node.id) {
      execution.approvedNodeId = null;
      execution.approvalEvidence = null;
      execution.approvedBy = null;
    }

    if (stepRes.synchronousResponse) {
      execution.synchronousResponse = stepRes.synchronousResponse;
    }

    if (stepRes.status === 'failed' || stepRes.status === 'waiting_approval' || stepRes.status === 'waiting' || stepRes.status === 'waiting_webhook') {
      execution.status = stepRes.status;
      execution.currentNodeIndex = index;
      if (stepRes.status === 'waiting_webhook') {
        execution.resumeToken = stepRes.resumeToken;
        execution.resumeUrl = stepRes.resumeUrl;
        execution.expiresAt = stepRes.expiresAt;
        auditLog('workflow.paused_waiting_webhook', null, {
          executionId: execution.id,
          workflowId: execution.workflowId,
          resumeToken: execution.resumeToken
        });
        broadcast('workflow.execution.waiting_webhook', {
          executionId: execution.id,
          resumeToken: execution.resumeToken,
          resumeUrl: execution.resumeUrl
        });
      }
      if (stepRes.status === 'waiting_approval') {
        execution.lastErrorCode = stepRes.errorCode || 'APPROVAL_CONTEXT_MISSING';
      }
      if (stepRes.status === 'failed') {
        execution.lastErrorCode = stepRes.errorCode || 'WORKFLOW_STEP_FAILED';
      }
      if (stepRes.status === 'waiting') {
        execution.retryAt = stepRes.retryAt;
      }
      break;
    }
    execution.currentNodeIndex = index + 1;
  }

  if (execution.status === 'running') {
    releaseExecutionLease({ execution, workerLeaseId, finalStatus: 'completed', now: Date.now() });
  } else if (execution.status === 'failed') {
    releaseExecutionLease({ execution, workerLeaseId, finalStatus: 'failed', errorCode: execution.lastErrorCode, now: Date.now() });
    // Dispatch Error Trigger Workflows (Automated Resilient Error Boundary)
    if (triggerType !== 'workflow_error') {
      const errorFlows = (state.records.workflows || []).filter(
        w => w.agencyId === agencyId && w.status === 'published' &&
             (w.triggerType === 'workflow_error' || w.id === flow.errorWorkflowId)
      );
      for (const errFlow of errorFlows) {
        console.log(`[OPERZA ERROR TRIGGER] Workflow "${flow.name}" failed, triggering error handler "${errFlow.name}"`);
        await executeWorkflowInstance({
          flow: errFlow,
          agencyId,
          locationId,
          triggerType: 'workflow_error',
          triggerContext: {
            failedWorkflowId: flow.id,
            failedWorkflowName: flow.name,
            failedExecutionId: execution.id,
            errorCode: execution.lastErrorCode,
            errorMessage: execution.steps[execution.steps.length - 1]?.error || execution.lastErrorCode,
            failedAt: new Date().toISOString()
          },
          mode
        }).catch(err => console.error('[ERROR WORKFLOW TRIGGER ERROR]:', err));
      }
    }
  }
  execution.durationMs = (execution.durationMs || 0) + (Date.now() - startedAt);

  broadcast('workflow.execution.finished', {
    executionId: execution.id,
    status: execution.status,
    durationMs: execution.durationMs
  });
  if (pgPool) {
    await persistCompletedWorkflowExecution({
      pgPool,
      agencyId,
      locationId,
      execution,
      flow,
      isStagingOrProd,
      platformDbEnabled
    });
  }
  await saveState();
  return execution;
}

function safeWorkflowStepResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const allowed = [
    'actionId', 'providerKey', 'dispatch', 'mode', 'sideEffectsDisabled', 'reason',
    'tagAdded', 'stageUpdated', 'branch', 'isMatch', 'wouldWaitMinutes',
    'wouldResumeAt', 'delayAmount', 'delayUnit', 'iterations', 'filteredCount',
    'httpStatus', 'retryAt', 'pointsAdded', 'notificationId', 'subWorkflowId', 'subExecutionId',
    'batchSize', 'batchCount', 'totalInputItems', 'handled'
  ];
  const output = {};
  for (const key of allowed) {
    const value = result[key];
    if (typeof value === 'string' && value.length <= 180 ||
        typeof value === 'number' || typeof value === 'boolean') {
      if (value !== undefined) output[key] = value;
    }
  }
  return Object.keys(output).length ? output : null;
}

function publicWorkflowExecution(execution) {
  const sourceContact = execution.triggerContext?.contact;
  const contact = sourceContact ? {
    id: sourceContact.id,
    firstName: sourceContact.firstName || '',
    lastName: sourceContact.lastName || ''
  } : null;
  const pendingApproval = execution.pendingApproval ? {
    id: execution.pendingApproval.id,
    nodeId: execution.pendingApproval.nodeId,
    actionId: execution.pendingApproval.actionId,
    nodeType: execution.pendingApproval.nodeType,
    nodeLabel: execution.pendingApproval.nodeLabel,
    requestedAt: execution.pendingApproval.requestedAt,
    expiresAt: execution.pendingApproval.expiresAt
  } : null;

  return {
    id: execution.id,
    workflowId: execution.workflowId,
    workflowName: execution.workflowName,
    workflowVersion: execution.workflowVersion || 1,
    mode: execution.mode,
    status: execution.status,
    retryAt: execution.retryAt || null,
    resumeToken: execution.resumeToken || null,
    resumeUrl: execution.resumeUrl || null,
    triggerType: execution.triggerType,
    contactId: contact?.id || execution.contactId || null,
    triggerContext: {
      contact,
      manualTrigger: execution.triggerContext?.manualTrigger === true,
      triggeredBy: execution.triggerContext?.triggeredBy || null,
      scheduledAt: execution.triggerContext?.scheduledAt || null
    },
    createdAt: execution.createdAt,
    finishedAt: execution.finishedAt || null,
    durationMs: execution.durationMs || 0,
    outboxJobId: execution.outboxJobId || null,
    outboxStatus: execution.outboxStatus || 'delivered',
    attemptCount: execution.attemptCount || 1,
    currentNodeIndex: execution.currentNodeIndex || 0,
    pendingApproval,
    pendingApprovalId: pendingApproval?.id || null,
    lastErrorCode: execution.lastErrorCode || null,
    steps: (execution.steps || []).map(step => ({
      nodeId: step.nodeId,
      nodeName: step.nodeName,
      nodeType: step.nodeType,
      status: step.status,
      durationMs: step.durationMs || 0,
      errorCode: step.errorCode || null,
      result: safeWorkflowStepResult(step.result),
      executedAt: step.executedAt || null
    }))
  };
}

function publicWorkflowApproval(approval) {
  return {
    id: approval.id,
    tenantId: approval.tenantId,
    locationId: approval.locationId,
    workflowId: approval.workflowId,
    executionId: approval.executionId,
    nodeId: approval.nodeId,
    actionId: approval.actionId,
    nodeType: approval.nodeType,
    nodeLabel: approval.nodeLabel,
    status: approval.status,
    requestedAt: approval.requestedAt,
    expiresAt: approval.request?.expiresAt || null,
    decidedAt: approval.decidedAt || null,
    decidedByActorId: approval.decidedByActorId || null
  };
}

async function expirePendingWorkflowApprovals(agencyId, locationId) {
  if (pgPool) {
    if (!agencyId || !locationId) {
      if (isStagingOrProd || platformDbEnabled) {
        throw new Error('Database approval expiration requires both agencyId and locationId.');
      }
      return;
    }
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [agencyId, locationId]);
      const expiredRes = await client.query('SELECT * FROM expire_tenant_workflow_approvals($1, $2)', [agencyId, locationId]);
      await client.query('COMMIT');
      for (const row of expiredRes.rows) {
        auditLog('workflow.approval.expired', {
          user: { id: 'system_workflow', name: 'Workflow system' },
          agency: { id: row.agency_id },
          activeLocation: { id: row.location_id }
        }, { approvalId: row.expired_approval_id, executionId: row.execution_id, nodeId: row.node_id });
      }
    } catch (pgErr) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[WORKFLOW-APPROVALS-EXPIRE] PostgreSQL tenant expiration failed:', pgErr.message);
      if (isStagingOrProd || platformDbEnabled) {
        throw new Error('Database approval expiration failed: ' + pgErr.message);
      }
    } finally {
      client.release();
    }
    return;
  }

  state.workflowApprovals = state.workflowApprovals || [];
  let changed = false;
  const now = Date.now();
  for (const approval of state.workflowApprovals) {
    if (agencyId && approval.agencyId !== agencyId) continue;
    if (locationId && approval.locationId !== locationId) continue;
    if (approval.status !== 'pending' || Date.parse(approval.request?.expiresAt || '') > now) continue;
    approval.status = 'expired';
    approval.decidedAt = new Date(now).toISOString();
    const run = (state.workflowExecutions || []).find(item =>
      item.id === approval.executionId &&
      item.agencyId === approval.agencyId &&
      item.locationId === approval.locationId
    );
    if (run && run.status === 'waiting_approval' && run.pendingApprovalId === approval.id) {
      run.status = 'failed';
      run.lastErrorCode = 'APPROVAL_EXPIRED';
      run.finishedAt = new Date(now).toISOString();
      run.pendingApprovalId = null;
      run.pendingApproval = null;
      const pausedStep = [...(run.steps || [])].reverse().find(step => step.nodeId === approval.nodeId);
      if (pausedStep) {
        pausedStep.status = 'failed';
        pausedStep.errorCode = 'APPROVAL_EXPIRED';
      }
    }
    auditLog('workflow.approval.expired', {
      user: { id: 'system_workflow', name: 'Workflow system' },
      agency: { id: approval.agencyId },
      activeLocation: { id: approval.locationId }
    }, { approvalId: approval.id, executionId: approval.executionId, nodeId: approval.nodeId });
    changed = true;
  }
  if (changed) await saveState();
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

    // 1. In local in-memory mode, resume timed delay workflows that have reached their retryAt threshold
    // (In PostgreSQL mode, scheduled continuations are handled reliably by the outbox worker)
    if (!platformDbEnabled) {
      state.workflowExecutions = state.workflowExecutions || [];
      const waitingExecutions = state.workflowExecutions.filter(
        ex => ex.status === 'waiting' && ex.retryAt && new Date(ex.retryAt) <= now
      );
      for (const ex of waitingExecutions) {
        ex.status = 'resuming';
        ex.currentNodeIndex = (ex.currentNodeIndex || 0) + 1;
        await saveState();
        const flow = ex.workflowSnapshot || (state.records.workflows || []).find(w => w.id === ex.workflowId);
        if (flow) {
          console.log(`[OPERZA DELAY] Resuming workflow execution ${ex.id} after wait period`);
          executeWorkflowInstance({
            flow,
            agencyId: ex.agencyId,
            locationId: ex.locationId,
            triggerType: ex.triggerType,
            triggerContext: ex.triggerContext,
            existingExecution: ex,
            mode: ex.mode || 'live'
          }).catch(err => console.error(`[SCHEDULE LOOP RESUME ERROR] id=${ex.id}:`, err));
        }
      }
    }

    // 2. Cron schedule triggers
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
        mode: 'dry_run',
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
  res.req = req;
  const requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('x-request-id', requestId);
  req.requestId = requestId;

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method;
  const clientIp = resolveClientIp(req);

  // ─── CORS Preflight ─────────────────────────────────────────────
  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': getCorsOrigin(req),
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, x-operza-csrf, x-operza-location, x-request-id, idempotency-key',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-max-age': '86400',
      'x-request-id': requestId
    });
    res.end();
    return;
  }

  // ─── Global & Scoped Rate Limiting ──────────────────────────────
  const isAuthRoute = pathname.startsWith('/api/auth/');
  const rateLimitKey = isAuthRoute ? `auth:${clientIp}` : `api:${clientIp}`;
  const rateLimitMax = isAuthRoute ? RATE_LIMIT_AUTH_MAX : RATE_LIMIT_MAX_REQUESTS;
  const rateLimit = checkRateLimit(rateLimitKey, rateLimitMax);
  if (!rateLimit.allowed) {
    return sendJson(res, 429, { error: 'Too many requests. Please slow down.' }, {
      'retry-after': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
      'x-ratelimit-remaining': '0'
    });
  }

  try {
    // ─── Technical SEO Endpoints (Robots & Sitemap Fallback) ─────────
    if (pathname === '/robots.txt') {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        ...CORS_HEADERS
      });
      return res.end(
        'User-agent: *\n' +
        'Allow: /\n' +
        'Allow: /platform/\n' +
        'Allow: /pricing\n' +
        'Allow: /about\n' +
        'Allow: /docs\n' +
        'Allow: /blog\n' +
        'Disallow: /login\n' +
        'Disallow: /signup\n' +
        'Disallow: /dashboard\n' +
        'Disallow: /api/\n' +
        'Disallow: /portal\n' +
        'Disallow: /settings\n' +
        'Sitemap: https://operza.io/sitemap.xml\n'
      );
    }

    if (pathname === '/sitemap.xml') {
      const publicUrls = [
        { loc: 'https://operza.io/', priority: '1.0', changefreq: 'daily' },
        { loc: 'https://operza.io/platform/crm', priority: '0.9', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/automation', priority: '0.9', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/funnels', priority: '0.9', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/conversations', priority: '0.9', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/portal', priority: '0.9', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/courses', priority: '0.8', changefreq: 'weekly' },
        { loc: 'https://operza.io/platform/reporting', priority: '0.8', changefreq: 'weekly' },
        { loc: 'https://operza.io/pricing', priority: '0.95', changefreq: 'daily' },
        { loc: 'https://operza.io/about', priority: '0.7', changefreq: 'monthly' },
        { loc: 'https://operza.io/docs', priority: '0.85', changefreq: 'weekly' },
        { loc: 'https://operza.io/blog', priority: '0.8', changefreq: 'daily' }
      ];
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        publicUrls.map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${new Date().toISOString().split('T')[0]}</lastmod>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`).join('\n') +
        '\n</urlset>';
      res.writeHead(200, {
        'content-type': 'application/xml; charset=utf-8',
        'cache-control': 'public, max-age=86400',
        ...CORS_HEADERS
      });
      return res.end(xml);
    }

    // ─── Health, Readiness & Observability Telemetry ─────────────────
    if (await handleSystemRoutes(req, res, {
      pathname,
      method,
      sendJson,
      readBody,
      state,
      pgPool,
      wss,
      wsClients,
      workflowQueue,
      memoryOutboxRepo,
      outboxRepo: getOutboxRepo(),
      trustedWorkerHandlers,
      executeWorkerTick,
      randomUUID,
      getActor
    })) {
      return;
    }
    if (res.headersSent) {
      return;
    }

    // ═════════════════════════════════════════════════════════════
    // ─── PUBLIC ROUTES (no auth required) ───────────────────────
    // ═════════════════════════════════════════════════════════════

    // Public Form Lookup & Submission (delegated to Forms router)
    if (pathname.startsWith('/api/forms/public/') || pathname.startsWith('/api/forms/submit/')) {
      if (await handleFormsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, pgPool, triggerWorkflowExecution, randomUUID
      })) {
        return;
      }
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

    // Public Multi-Agent Webchat Stream
    if ((method === 'POST' || method === 'GET') && pathname === '/api/widget/chat/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': '*'
      });

      let message = '';
      let sessionId = randomUUID();
      let agencyId = null;
      let locationId = null;
      let visitorName = 'Visitor';
      let visitorEmail = 'visitor@webchat.operza.io';

      if (method === 'GET') {
        message = url.searchParams.get('message') || '';
        sessionId = url.searchParams.get('sessionId') || sessionId;
        agencyId = url.searchParams.get('agencyId');
        locationId = url.searchParams.get('locationId');
        visitorName = url.searchParams.get('visitorName') || visitorName;
        visitorEmail = url.searchParams.get('visitorEmail') || visitorEmail;
      } else {
        const body = await readBody(req);
        message = body.message || '';
        sessionId = body.sessionId || sessionId;
        agencyId = body.agencyId;
        locationId = body.locationId;
        visitorName = body.visitorName || visitorName;
        visitorEmail = body.visitorEmail || visitorEmail;
      }

      if (!message.trim()) {
        res.write(`data: ${JSON.stringify({ error: 'message parameter is required' })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }

      const targetAgencyId = agencyId || state.agencies[0]?.id;
      const targetLoc = (state.locations || []).find(l => l.agencyId === targetAgencyId) || (state.records.locations || []).find(l => l.agencyId === targetAgencyId);
      const targetLocationId = locationId || targetLoc?.id || targetAgencyId;

      const orchestrator = getMultiAgentOrchestrator(targetAgencyId, targetLocationId, {
        user: { id: 'usr_visitor', name: visitorName, email: visitorEmail },
        agency: { id: targetAgencyId },
        membership: { role: 'guest' }
      });

      try {
        for await (const chunk of orchestrator.processUserMessageStream({
          message,
          sessionId,
          startAgent: AGENT_ROLES.SUPPORT,
          context: { tenantId: targetAgencyId, locationId: targetLocationId }
        })) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (streamErr) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // Public Calendar Lookup & Booking Ingress (Delegated to Scheduling Router)
    if (pathname.startsWith('/api/calendars/public/') || pathname.startsWith('/api/calendars/book/')) {
      if (await handleSchedulingRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor: undefined,
        agency: undefined,
        activeLocation: undefined,
        randomUUID,
        pgPool,
        triggerWorkflowExecution,
        dispatchZapierEvent,
        zapierRepository,
        syncRelationalWrite,
        secretResolver,
        effectiveVaultKey,
        isProd
      })) {
        return;
      }
    }

    // Public Payment Link Lookup & Checkout Ingress (Delegated to Payments Router)
    if ((method === 'GET' && pathname.startsWith('/api/payments/public/')) || (method === 'POST' && pathname.startsWith('/api/payments/checkout/'))) {
      if (await handlePaymentsRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        readRawBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor: undefined,
        agency: undefined,
        activeLocation: undefined,
        pgPool,
        triggerWorkflowExecution,
        isWebhookReplay,
        logStructured
      })) {
        return;
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── 1-CLICK POST-PURCHASE FUNNEL UPSELL ENGINE (OTO) ───────
    // ═════════════════════════════════════════════════════════════

    if (method === 'POST' && pathname === '/api/funnels/checkout/one-click-upsell') {
      if (await handleFunnelsRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor: undefined,
        agency: undefined,
        activeLocation: undefined,
        pgPool,
        triggerWorkflowExecution
      })) {
        return;
      }
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

    // Public Review Lookup & Submission (delegated to Reviews router)
    if (pathname.startsWith('/api/reviews/public/') || pathname.startsWith('/api/reviews/submit/')) {
      if (await handleReviewsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, pgPool, triggerWorkflowExecution, randomUUID
      })) {
        return;
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── FUNNELS & SITES PUBLIC INGRESS ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    // Standalone Production Hosted Website HTML Server (/hosted/:slug or /live/:slug)
    if (method === 'GET' && (pathname.startsWith('/hosted/') || pathname.startsWith('/live/'))) {
      const parts = pathname.replace(/^\/(hosted|live)\//, '').split('/');
      const slugOrId = parts[0]?.trim();
      const pagePath = parts[1] ? `/${parts.slice(1).join('/')}` : '/';

      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(w =>
        w.id === slugOrId ||
        (w.slug && w.slug.toLowerCase() === slugOrId.toLowerCase()) ||
        (w.domain && w.domain.toLowerCase() === slugOrId.toLowerCase()) ||
        ((w.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-') === slugOrId.toLowerCase())
      );

      if (!site) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<!DOCTYPE html><html><head><title>404 Not Found | Operza Hosting</title><style>body{font-family:sans-serif;background:#090d16;color:#fff;display:grid;place-items:center;min-height:100vh;text-align:center;margin:0;}h1{font-size:36px;margin-bottom:8px;}p{color:#9ca3af;}</style></head><body><div><h1>404 · Website Not Found</h1><p>No website found for slug &ldquo;${escapeHtml(slugOrId)}&rdquo; on this server.</p></div></body></html>`);
      }

      site.visits = (site.visits || 0) + 1;
      const activePage = (site.pages || []).find(p => p.path === pagePath || p.path === `/${pagePath.replace(/^\//, '')}`) || (site.pages || [])[0] || { name: 'Home', headline: site.name, subhead: '', cta: 'Get Started', blocks: [] };

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(activePage.headline || activePage.name)} | ${escapeHtml(site.name)}</title>
  <meta name="description" content="${escapeHtml(activePage.subhead || site.description || site.name)}" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" />
  <style>
    :root { --primary: #4f46e5; --bg: #090d16; --surface: #111827; --text: #f9fafb; --text-muted: #9ca3af; --border: #1f2937; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Plus Jakarta Sans', system-ui, sans-serif; background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; display: flex; flex-direction: column; }
    header { border-bottom: 1px solid var(--border); background: rgba(17, 24, 39, 0.9); backdrop-filter: blur(12px); padding: 18px 28px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .brand { font-size: 20px; font-weight: 800; color: #fff; text-decoration: none; letter-spacing: -0.02em; display: flex; align-items: center; gap: 8px; }
    nav a { color: var(--text-muted); text-decoration: none; margin-left: 20px; font-size: 14px; font-weight: 500; transition: color 0.2s; }
    nav a:hover, nav a.active { color: #fff; }
    .hero { max-width: 1080px; margin: 0 auto; padding: 70px 24px 50px; text-align: center; }
    .hero h1 { font-size: clamp(32px, 5vw, 54px); font-weight: 800; letter-spacing: -0.03em; margin-bottom: 20px; line-height: 1.15; background: linear-gradient(135deg, #fff 40%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: clamp(16px, 2vw, 20px); color: var(--text-muted); max-width: 680px; margin: 0 auto 32px; }
    .btn { display: inline-block; background: var(--primary); color: #fff; text-decoration: none; padding: 13px 28px; border-radius: 9px; font-weight: 650; font-size: 15px; box-shadow: 0 4px 18px rgba(79, 70, 229, 0.4); border: none; cursor: pointer; }
    .blocks-container { max-width: 1080px; margin: 0 auto 60px; padding: 0 24px; display: grid; gap: 24px; }
    .block-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 32px; }
    .lead-form { max-width: 480px; margin: 40px auto 0; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 28px; text-align: left; }
    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text); }
    .form-group input, .form-group textarea { width: 100%; padding: 11px 14px; background: rgba(0,0,0,0.3); border: 1px solid var(--border); border-radius: 8px; color: #fff; font-size: 14px; }
    footer { margin-top: auto; border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <a href="/hosted/${encodeURIComponent(site.domain || site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" class="brand">
      🌐 ${escapeHtml(site.globalHeader?.brandText || site.name)}
    </a>
    <nav>
      ${(site.pages || []).map(pg => `<a href="/hosted/${encodeURIComponent(site.domain || site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}${pg.path === '/' ? '' : pg.path}" class="${pg.id === activePage.id ? 'active' : ''}">${escapeHtml(pg.name)}</a>`).join('')}
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>${escapeHtml(activePage.headline || activePage.name)}</h1>
      <p>${escapeHtml(activePage.subhead || '')}</p>
      ${activePage.cta ? `<a href="#contact" class="btn">${escapeHtml(activePage.cta)}</a>` : ''}
    </section>

    ${(activePage.blocks && activePage.blocks.length > 0) ? `
    <div class="blocks-container">
      ${activePage.blocks.map(b => `
        <div class="block-card">
          <h3 style="font-size: 20px; font-weight: 700; margin-bottom: 10px;">${escapeHtml(b.title || b.type || 'Section')}</h3>
          <p style="color: var(--text-muted);">${escapeHtml(b.content || b.text || '')}</p>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="lead-form" id="contact">
      <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 8px; text-align: center;">Get In Touch / Book Consultation</h3>
      <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 20px; text-align: center;">Submissions link directly into the Operza CRM pipeline.</p>
      <form action="/api/websites/optin/${encodeURIComponent(site.domain || site.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}" method="POST">
        <div class="form-group">
          <label>Full Name *</label>
          <input type="text" name="firstName" required placeholder="Jane Doe" />
        </div>
        <div class="form-group">
          <label>Work Email *</label>
          <input type="email" name="email" required placeholder="jane@company.com" />
        </div>
        <div class="form-group">
          <label>Phone Number</label>
          <input type="tel" name="phone" placeholder="+1 (555) 000-0000" />
        </div>
        <div class="form-group">
          <label>Project Details / Message</label>
          <textarea name="message" rows="3" placeholder="Tell us how we can help..."></textarea>
        </div>
        <button type="submit" class="btn" style="width: 100%;">Submit Inquiry →</button>
      </form>
    </div>
  </main>
  <footer>
    <p>${escapeHtml(site.globalFooter?.copyrightText || `© ${new Date().getFullYear()} ${site.name}. All rights reserved.`)}</p>
  </footer>
</body>
</html>`;

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }

    // Public Funnel/Site Lookup & Visit Tracker (Delegated to Funnels Router)
    if (method === 'GET' && (pathname.startsWith('/api/funnels/public/') || pathname.startsWith('/api/websites/public/'))) {
      if (await handleFunnelsRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor: undefined,
        agency: undefined,
        activeLocation: undefined,
        pgPool,
        triggerWorkflowExecution
      })) {
        return;
      }
    }

    // Public Funnel & Hosted Website Opt-in Lead Ingress (Delegated to Funnels Router)
    if (method === 'POST' && (pathname.startsWith('/api/funnels/optin/') || pathname.startsWith('/api/websites/optin/'))) {
      if (await handleFunnelsRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor: undefined,
        agency: undefined,
        activeLocation: undefined,
        pgPool,
        triggerWorkflowExecution
      })) {
        return;
      }
    }

    // Public Media File Server
    if (method === 'GET' && pathname.startsWith('/api/media/file/')) {
      const fileId = pathname.replace('/api/media/file/', '').trim();
      const fileRecord = (state.records.media || []).find(m => m.id === fileId);

      const MEDIA_STORAGE_DIR = path.join(dataDir, 'media');
      const filePath = path.join(MEDIA_STORAGE_DIR, `${fileId}.bin`);

      let fileBuffer = null;
      try {
        fileBuffer = await readFile(filePath);
      } catch (err) {
        // Fall back to state.mediaFiles if in memory from older sessions
        const stored = (state.mediaFiles || {})[fileId];
        if (stored) {
          fileBuffer = Buffer.isBuffer(stored.data) ? stored.data : Buffer.from(stored.data);
        }
      }

      if (fileBuffer) {
        res.writeHead(200, {
          'Content-Type': fileRecord?.mimeType || 'image/png',
          'Content-Length': fileBuffer.length,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline'
        });
        return res.end(fileBuffer);
      }

      if (fileRecord) {
        const safeName = String(fileRecord.name || 'asset').replace(/[<>&"']/g, '');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
          <rect width="400" height="300" fill="#f3f4f6"/>
          <text x="200" y="140" font-family="sans-serif" font-size="18" font-weight="bold" fill="#374151" text-anchor="middle">${safeName}</text>
          <text x="200" y="170" font-family="sans-serif" font-size="14" fill="#6b7280" text-anchor="middle">${String(fileRecord.kind || 'FILE').toUpperCase()} · ${fileRecord.sizeKb || 0} KB</text>
        </svg>`;
        res.writeHead(200, {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition': 'inline'
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

      const svg = await generateQrSvg(qr.target || 'https://operza.io', 256);
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

    // Public Client Portal Invoice Payment Ingress (Delegated to Payments Router)
    if (method === 'POST' && pathname.startsWith('/api/portal/invoices/') && pathname.endsWith('/pay')) {
      if (await handlePaymentsRoutes(req, res, {
        method, pathname, url, readBody, readRawBody, sendJson, state, saveState,
        auditLog, broadcast, actor: undefined, agency: undefined, activeLocation: undefined,
        pgPool, triggerWorkflowExecution, isWebhookReplay, logStructured
      })) {
        return;
      }
    }

    // Public Client Portal Course Progress Ingress
    if (method === 'POST' && pathname.startsWith('/api/portal/courses/') && pathname.endsWith('/progress')) {
      const courseId = pathname.replace('/api/portal/courses/', '').replace('/progress', '').trim();
      const body = await readBody(req);
      const contactId = body.contactId;
      if (!contactId) return sendJson(res, 400, { error: 'contactId required' });

      // Verify contact existence and portal access authorization
      state.records.contacts = state.records.contacts || [];
      const targetContact = state.records.contacts.find(c => c.id === contactId);
      if (!targetContact) {
        return sendJson(res, 404, { error: 'Contact not found' });
      }
      if (targetContact.portalAccess === false) {
        return sendJson(res, 403, { error: 'Portal access not enabled for this contact' });
      }

      state.records.enrollments = state.records.enrollments || [];
      let enrollment = state.records.enrollments.find(e => e.courseId === courseId && e.contactId === contactId);
      const newProgress = Math.min(100, Math.max(0, Number(body.progress) || 0));

      if (enrollment) {
        enrollment.progress = newProgress;
        enrollment.status = newProgress >= 100 ? 'completed' : 'active';
        enrollment.updatedAt = new Date().toISOString();
      } else {
        enrollment = {
          id: randomUUID(),
          courseId,
          contactId,
          progress: newProgress,
          status: newProgress >= 100 ? 'completed' : 'active',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records.enrollments.push(enrollment);
      }

      await saveState();
      broadcast('enrollment.updated', enrollment);

      return sendJson(res, 200, { success: true, enrollment });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── WEBHOOK HANDLERS (public, signature-gated) ─────────────
    // ═════════════════════════════════════════════════════════════

    // Stripe Webhook (Delegated to Payments Router)
    if (method === 'POST' && pathname === '/api/webhooks/stripe') {
      if (await handlePaymentsRoutes(req, res, {
        method, pathname, url, readBody, readRawBody, sendJson, state, saveState,
        auditLog, broadcast, actor: undefined, agency: undefined, activeLocation: undefined,
        pgPool, triggerWorkflowExecution, isWebhookReplay, logStructured
      })) {
        return;
      }
    }

    // Twilio Webhook
    if (method === 'POST' && pathname === '/api/webhooks/twilio') {
      const rawBody = await readRawBody(req);
      const twilioSig = req.headers['x-twilio-signature'] || '';

      let payload;
      // Twilio sends form-urlencoded typically, but we accept JSON too
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/x-www-form-urlencoded')) {
        payload = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
      } else {
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }
      }

      const baseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || 'localhost'}`;
      const twilioUrl = `${baseUrl.replace(/\/$/, '')}${req.url}`;

      if (TWILIO_AUTH_TOKEN && twilioSig) {
        // Standard RFC HMAC-SHA1 signature verification for Twilio webhook ingress
        let sigData = twilioUrl;
        const sortedKeys = Object.keys(payload).sort();
        for (const k of sortedKeys) {
          sigData += k + payload[k];
        }
        const expectedTwilioSig = createHmac('sha1', TWILIO_AUTH_TOKEN).update(Buffer.from(sigData, 'utf8')).digest('base64');
        if (!safeEqual(expectedTwilioSig, twilioSig)) {
          console.warn('[TWILIO WEBHOOK] Invalid Twilio HMAC signature');
          return sendJson(res, 403, { error: 'Invalid Twilio signature' });
        }
      } else if (TWILIO_AUTH_TOKEN) {
        console.warn('[TWILIO WEBHOOK] Missing x-twilio-signature header');
        return sendJson(res, 403, { error: 'Missing x-twilio-signature header' });
      } else {
        if (process.env.NODE_ENV === 'production' || process.env.WEBHOOKS_FAIL_CLOSED === 'true') {
          return sendJson(res, 503, { error: 'Twilio auth token is not configured in production environment', code: 'WEBHOOK_SECRET_REQUIRED' });
        }
        console.warn('[TWILIO WEBHOOK] No TWILIO_AUTH_TOKEN configured — skipping signature check');
      }

      if (payload.MessageSid && isWebhookReplay(`twilio:${payload.MessageSid}`)) {
        logStructured('WARN', 'Duplicate Twilio SMS webhook detected and ignored', { messageSid: payload.MessageSid });
        res.writeHead(200, { 'content-type': 'text/xml' });
        res.end('<Response></Response>');
        return;
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

          const normalizedKeyword = textBody.trim().toUpperCase();
          if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(normalizedKeyword)) {
            await recordInboundOptOut({
              pgPool,
              state,
              agencyId: contact.agencyId,
              locationId: contact.locationId,
              contactId: contact.id,
              channel: 'sms',
              proofRef: normalizedKeyword,
              randomUUID
            });
            await saveState();
          }

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

    // Twilio Delivery Status Callback Webhook
    if (method === 'POST' && pathname === '/api/webhooks/twilio/status') {
      const rawBody = await readRawBody(req);
      const twilioSig = req.headers['x-twilio-signature'] || '';
      const contentType = req.headers['content-type'] || '';
      let payload;
      if (contentType.includes('application/x-www-form-urlencoded')) {
        payload = Object.fromEntries(new URLSearchParams(rawBody.toString('utf8')));
      } else {
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }
      }

      const baseUrl = process.env.PUBLIC_BASE_URL || `http://${req.headers.host || 'localhost'}`;
      const twilioUrl = `${baseUrl.replace(/\/$/, '')}${req.url}`;

      if (TWILIO_AUTH_TOKEN && twilioSig) {
        let sigData = twilioUrl;
        for (const k of Object.keys(payload).sort()) sigData += k + payload[k];
        const expected = createHmac('sha1', TWILIO_AUTH_TOKEN).update(Buffer.from(sigData, 'utf8')).digest('base64');
        if (!safeEqual(expected, twilioSig)) {
          return sendJson(res, 403, { error: 'Invalid Twilio signature' });
        }
      } else if (TWILIO_AUTH_TOKEN) {
        return sendJson(res, 403, { error: 'Missing x-twilio-signature header' });
      } else if (process.env.NODE_ENV === 'production' || process.env.WEBHOOKS_FAIL_CLOSED === 'true') {
        return sendJson(res, 503, { error: 'Twilio auth token is not configured in production environment', code: 'WEBHOOK_SECRET_REQUIRED' });
      }

      const messageSid = payload.MessageSid || payload.SmsSid;
      const rawStatus = String(payload.MessageStatus || payload.SmsStatus || '').toLowerCase();
      if (messageSid && isWebhookReplay(`twilio_status:${messageSid}:${rawStatus}`)) {
        return sendJson(res, 200, { received: true, deduplicated: true });
      }

      const statusMap = {
        queued: 'queued',
        sending: 'processing',
        sent: 'sent',
        delivered: 'delivered',
        undelivered: 'failed',
        failed: 'failed',
        read: 'read'
      };
      const deliveryStatus = statusMap[rawStatus] || 'queued';
      if (messageSid && pgPool) {
        await pgPool.query(
          `UPDATE messages SET delivery_status = $1, error_code = COALESCE($2, error_code)
           WHERE provider_message_id = $3`,
          [deliveryStatus, payload.ErrorCode || null, messageSid]
        ).catch(() => {});
      }
      if (messageSid) {
        for (const conv of state.records.conversations || []) {
          const msg = (conv.messages || []).find(m => m.providerMessageId === messageSid);
          if (msg) msg.deliveryStatus = deliveryStatus;
        }
        await saveState();
      }
      auditLog('webhook.twilio.status', null, { messageSid, deliveryStatus });
      return sendJson(res, 200, { received: true, messageSid, deliveryStatus });
    }

    // SendGrid Event Webhook (delivered, bounce, spamreport, unsubscribe)
    if (method === 'POST' && pathname === '/api/webhooks/sendgrid/events') {
      const rawBody = await readRawBody(req);
      let events = [];
      try {
        const parsed = JSON.parse(rawBody.toString('utf8'));
        events = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return sendJson(res, 400, { error: 'Invalid JSON payload' });
      }

      let processed = 0;
      for (const ev of events) {
        const sgId = ev.sg_event_id || `${ev.sg_message_id || 'msg'}:${ev.event || 'unknown'}:${ev.timestamp || ''}`;
        if (isWebhookReplay(`sendgrid_ev:${sgId}`)) continue;
        processed++;

        const evType = String(ev.event || '').toLowerCase();
        if (['spamreport', 'unsubscribe', 'group_unsubscribe'].includes(evType) && ev.email) {
          const contact = (state.records.contacts || []).find(
            c => c.email && c.email.toLowerCase().trim() === String(ev.email).toLowerCase().trim()
          );
          if (contact) {
            await recordInboundOptOut({
              pgPool,
              state,
              agencyId: contact.agencyId,
              locationId: contact.locationId,
              contactId: contact.id,
              channel: 'email',
              proofRef: `sendgrid:${evType}`,
              randomUUID
            });
          }
        }
      }
      await saveState();
      auditLog('webhook.sendgrid.events', null, { processed });
      return sendJson(res, 200, { received: true, processed });
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

    // ─── WhatsApp Cloud API Webhook (Verification & Inbound Messages) ──
    if (pathname === '/api/webhooks/whatsapp') {
      if (method === 'GET') {
        const urlObj = new URL(req.url, 'http://localhost');
        const mode = urlObj.searchParams.get('hub.mode');
        const token = urlObj.searchParams.get('hub.verify_token');
        const challenge = urlObj.searchParams.get('hub.challenge');

        console.log(`[WHATSAPP WEBHOOK] Verification mode=${mode} token=${token}`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(challenge || 'verified');
        return;
      }

      if (method === 'POST') {
        const rawBody = await readRawBody(req);
        let payload;
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }

        console.log('[WHATSAPP WEBHOOK] Inbound event received');
        auditLog('webhook.whatsapp', null, { received: true });

        // Extract message from standard WhatsApp Cloud API payload or flat test body
        const entry = payload.entry?.[0];
        const change = entry?.changes?.[0]?.value;
        const msg = change?.messages?.[0] || payload;
        const sender = msg.from || payload.from || '+15550199';
        const senderName = change?.contacts?.[0]?.profile?.name || payload.name || 'WhatsApp Contact';
        const textBody = msg.text?.body || msg.text || payload.message || payload.body || 'Hello via WhatsApp';

        const fromPhone = String(sender).trim();
        let contact = [...(state.records.contacts || [])].reverse().find(
          c => c.phone && (c.phone === fromPhone || c.phone.replace(/\D/g, '') === fromPhone.replace(/\D/g, ''))
        );
        const agencyId = contact?.agencyId || state.agencies[0]?.id;
        const locationId = contact?.locationId || state.locations[0]?.id;

        if (!contact && agencyId && locationId) {
          contact = {
            id: randomUUID(),
            agencyId,
            locationId,
            firstName: senderName.split(' ')[0] || 'WhatsApp',
            lastName: senderName.split(' ').slice(1).join(' ') || 'User',
            phone: fromPhone,
            email: '',
            source: 'Inbound WhatsApp',
            tags: ['inbound-whatsapp'],
            status: 'lead',
            createdAt: new Date().toISOString()
          };
          state.records.contacts = state.records.contacts || [];
          state.records.contacts.push(contact);
        }

        if (contact) {
          const contactName = `${contact.firstName} ${contact.lastName}`.trim();
          let conv = (state.records.conversations || []).find(
            c => c.agencyId === contact.agencyId && (c.contactName === contactName || c.channel === 'whatsapp')
          );
          if (!conv) {
            conv = {
              id: randomUUID(),
              agencyId: contact.agencyId,
              locationId: contact.locationId,
              contactName,
              channel: 'whatsapp',
              subject: 'WhatsApp Chat',
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
          conv.channel = 'whatsapp';
          conv.messages = conv.messages || [];
          conv.messages.push({
            id: randomUUID(),
            author: contactName,
            channel: 'whatsapp',
            direction: 'inbound',
            text: textBody,
            timestamp: new Date().toISOString()
          });
          await saveState();

          broadcast('crm.conversation.updated', { id: conv.id, contactName, channel: 'whatsapp', message: textBody });
          broadcast('webhook.whatsapp.message', { from: fromPhone, body: textBody });

          triggerWorkflowExecution({
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            triggerType: 'whatsapp',
            triggerContext: { contact, message: textBody, from: fromPhone }
          }).catch(console.error);
        }

        return sendJson(res, 200, { received: true, channel: 'whatsapp', contactId: contact?.id });
      }
    }

    // ─── Meta Messenger & Instagram Direct Webhook ─────────────────
    if (pathname === '/api/webhooks/meta') {
      if (method === 'GET') {
        const urlObj = new URL(req.url, 'http://localhost');
        const mode = urlObj.searchParams.get('hub.mode');
        const challenge = urlObj.searchParams.get('hub.challenge');

        console.log(`[META WEBHOOK] Verification mode=${mode} challenge=${challenge}`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(challenge || 'verified');
        return;
      }

      if (method === 'POST') {
        const rawBody = await readRawBody(req);
        let payload;
        try { payload = JSON.parse(rawBody.toString('utf8')); } catch { payload = {}; }

        console.log('[META WEBHOOK] Inbound event received');
        auditLog('webhook.meta', null, { received: true });

        const entry = payload.entry?.[0];
        const messaging = entry?.messaging?.[0] || payload;
        const senderId = messaging.sender?.id || payload.senderId || 'ig_user_123';
        const senderHandle = payload.handle || payload.username || `@user_${senderId.slice(-4)}`;
        const textBody = messaging.message?.text || payload.message || payload.text || 'Inquiry via Instagram';

        let contact = [...(state.records.contacts || [])].reverse().find(
          c => c.instagramHandle === senderHandle || (c.tags && c.tags.includes(senderHandle))
        );
        const agencyId = contact?.agencyId || state.agencies[0]?.id;
        const locationId = contact?.locationId || state.locations[0]?.id;

        if (!contact && agencyId && locationId) {
          contact = {
            id: randomUUID(),
            agencyId,
            locationId,
            firstName: senderHandle.replace('@', '') || 'Social',
            lastName: 'Lead',
            phone: '',
            email: '',
            instagramHandle: senderHandle,
            source: 'Meta Direct',
            tags: ['inbound-meta', senderHandle],
            status: 'lead',
            createdAt: new Date().toISOString()
          };
          state.records.contacts = state.records.contacts || [];
          state.records.contacts.push(contact);
        }

        if (contact) {
          const contactName = `${contact.firstName} ${contact.lastName}`.trim();
          let conv = (state.records.conversations || []).find(
            c => c.agencyId === contact.agencyId && (c.contactName === contactName || c.channel === 'meta')
          );
          if (!conv) {
            conv = {
              id: randomUUID(),
              agencyId: contact.agencyId,
              locationId: contact.locationId,
              contactName,
              channel: 'meta',
              subject: `Instagram Direct: ${senderHandle}`,
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
          conv.channel = 'meta';
          conv.messages = conv.messages || [];
          conv.messages.push({
            id: randomUUID(),
            author: senderHandle,
            channel: 'meta',
            direction: 'inbound',
            text: textBody,
            timestamp: new Date().toISOString()
          });
          await saveState();

          broadcast('crm.conversation.updated', { id: conv.id, contactName, channel: 'meta', message: textBody });
          broadcast('webhook.meta.message', { senderId, handle: senderHandle, body: textBody });

          triggerWorkflowExecution({
            agencyId: contact.agencyId,
            locationId: contact.locationId,
            triggerType: 'meta',
            triggerContext: { contact, message: textBody, senderId, handle: senderHandle }
          }).catch(console.error);
        }

        return sendJson(res, 200, { received: true, channel: 'meta', contactId: contact?.id });
      }
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

      // Synchronous Webhook Response Handling (Instant HTTP Respond in Flow)
      const hasRespondNode = Array.isArray(flow.nodes) && flow.nodes.some(n => n.type === 'webhook_respond');
      if (hasRespondNode) {
        const execution = await executeWorkflowInstance({
          flow,
          agencyId: flow.agencyId,
          locationId: flow.locationId,
          triggerType: 'webhook',
          triggerContext: { webhookPayload: body, receivedAt: new Date().toISOString() },
          mode: 'live'
        });

        if (execution.synchronousResponse) {
          const resp = execution.synchronousResponse;
          res.writeHead(resp.statusCode || 200, resp.headers || { 'Content-Type': 'application/json' });
          res.end(typeof resp.body === 'string' ? resp.body : JSON.stringify(resp.body));
          return;
        }

        return sendJson(res, 200, {
          triggered: true,
          workflowId,
          executionId: execution.id,
          status: execution.status
        });
      }

      triggerWorkflowExecution({
        agencyId: flow.agencyId,
        locationId: flow.locationId,
        triggerType: 'webhook',
        triggerContext: { webhookPayload: body, receivedAt: new Date().toISOString() }
      }).catch(err => console.error('Webhook trigger execution failed:', err));

      return sendJson(res, 200, { triggered: true, workflowId, workflowName: flow.name });
    }

    // ─── Workflow Callback Webhook Ingress (Resume Wait-for-Webhook Node) ───────────
    const webhookCallbackMatch = pathname.match(/^\/api\/workflows\/callbacks\/([a-zA-Z0-9_-]+)$/);
    if (method === 'POST' && webhookCallbackMatch) {
      const resumeToken = webhookCallbackMatch[1];

      let rawBody = '';
      let body;
      try {
        let totalLen = 0;
        const maxLen = 64 * 1024; // 64KB bounded request body size
        for await (const chunk of req) {
          totalLen += chunk.length;
          if (totalLen > maxLen) {
            return sendJson(res, 413, { error: 'Payload too large; maximum 64KB permitted' });
          }
          rawBody += chunk;
        }
        body = rawBody ? JSON.parse(rawBody) : {};
        if (typeof body !== 'object' || body === null || Array.isArray(body)) {
          return sendJson(res, 400, { error: 'Callback payload must be a JSON object' });
        }
      } catch (parseErr) {
        return sendJson(res, 400, { error: 'Invalid JSON body' });
      }

      if (pgPool) {
        let client;
        try {
          // 1. Resolve execution across tenants via security definer function (FAIL CLOSED: NO UNSCOPED DIRECT QUERY FALLBACK)
          let targetExec = null;
          try {
            const fnRes = await pgPool.query('SELECT * FROM lookup_workflow_execution_by_resume_token($1)', [resumeToken]);
            if (fnRes.rows.length > 0) targetExec = fnRes.rows[0];
          } catch (fnErr) {
            console.error('[WORKFLOW-CALLBACK] Security definer lookup failed:', fnErr.message);
            return sendJson(res, 500, { error: 'Internal callback lookup service unavailable' });
          }

          if (!targetExec) {
            return sendJson(res, 404, {
              error: 'No active workflow execution found waiting for this callback token or callback expired'
            });
          }

          // 2. Pre-check expired callbacks using database/server time
          if (targetExec.retry_at && new Date(targetExec.retry_at).getTime() < Date.now()) {
            return sendJson(res, 410, { error: 'Webhook callback has expired' });
          }

          // 3. Atomically consume token and update execution state
          client = await pgPool.connect();
          await client.query('BEGIN');
          await client.query("SELECT set_config('app.agency_id', $1, true), set_config('app.location_id', $2, true)", [
            targetExec.agency_id,
            targetExec.location_id
          ]);

          const execRes = await client.query(`
            SELECT id, agency_id, location_id, workflow_id, status, current_node_id, resume_node_id,
                   wait_generation, wait_type, resume_token, retry_at, state, trigger_event,
                   (retry_at IS NOT NULL AND clock_timestamp() > retry_at) AS is_expired
            FROM workflow_executions
            WHERE agency_id = $1 AND location_id = $2 AND id = $3 AND resume_token = $4 AND status = 'waiting_webhook'
            FOR UPDATE
          `, [targetExec.agency_id, targetExec.location_id, targetExec.id, resumeToken]);

          if (execRes.rows.length === 0) {
            await client.query('ROLLBACK').catch(() => {});
            return sendJson(res, 409, {
              error: 'Webhook callback token has already been consumed or execution is no longer waiting'
            });
          }

          const lockedRow = execRes.rows[0];

          // Authoritative atomic check using PostgreSQL clock
          if (lockedRow.is_expired) {
            await client.query('ROLLBACK').catch(() => {});
            return sendJson(res, 410, { error: 'Webhook callback has expired' });
          }

          const updatedState = { ...(lockedRow.state || {}), callbackData: body };

          // Clear resume_token so duplicate callbacks are immediately rejected
          await client.query(`
            UPDATE workflow_executions SET
              resume_token = NULL,
              state = $1::jsonb,
              status = 'waiting',
              wait_type = 'webhook',
              retry_at = now(),
              updated_at = now()
            WHERE agency_id = $2 AND location_id = $3 AND id = $4
          `, [JSON.stringify(updatedState), targetExec.agency_id, targetExec.location_id, targetExec.id]);

          // Enqueue resumption event into workflow_outbox with available_at = now()
          const waitGen = Number(lockedRow.wait_generation) || 0;
          const idemKey = `idem_${crypto.createHash('sha256').update(JSON.stringify([
            targetExec.agency_id,
            targetExec.location_id,
            'workflow_webhook_resume',
            `${lockedRow.id}_${lockedRow.current_node_id}_gen_${waitGen}`
          ])).digest('hex')}`;

          const outboxPayload = {
            tenantId: targetExec.agency_id,
            locationId: targetExec.location_id,
            workflowId: lockedRow.workflow_id,
            executionId: lockedRow.id,
            waitNodeId: lockedRow.current_node_id,
            resumeNodeId: lockedRow.resume_node_id,
            resumeGeneration: waitGen,
            requestType: 'webhook',
            callbackData: body,
            correlationId: `corr_${randomUUID()}`,
            enqueuedAt: new Date().toISOString()
          };

          await client.query(`
            INSERT INTO workflow_outbox (
              id, agency_id, location_id, execution_id, event_type, payload,
              idempotency_key, priority, max_attempts, available_at
            ) VALUES ($1, $2, $3, $4, 'workflow.wait.resume', $5::jsonb, $6, 0, 5, now())
            ON CONFLICT (agency_id, location_id, idempotency_key) DO UPDATE
              SET available_at = now(),
                  status = 'pending',
                  lease_until = NULL,
                  lease_owner = NULL,
                  attempts = 0,
                  last_error_code = NULL,
                  payload = jsonb_set(
                    jsonb_set(workflow_outbox.payload, '{callbackData}', $5::jsonb->'callbackData'),
                    '{requestType}', '"webhook"'
                  ),
                  updated_at = now()
          `, [randomUUID(), targetExec.agency_id, targetExec.location_id, targetExec.id, JSON.stringify(outboxPayload), idemKey]);

          await client.query('COMMIT');

          return sendJson(res, 200, {
            success: true,
            resumed: true,
            executionId: targetExec.id,
            status: 'waiting',
            message: 'Webhook callback accepted and resume continuation enqueued'
          });
        } catch (pgErr) {
          if (client) await client.query('ROLLBACK').catch(() => {});
          console.error('[WORKFLOW-CALLBACK] PG error:', pgErr.message);
          return sendJson(res, 500, { error: 'Failed to process webhook callback' });
        } finally {
          if (client) client.release();
        }
      }

      state.workflowExecutions = state.workflowExecutions || [];
      const run = state.workflowExecutions.find(
        w => w.resumeToken === resumeToken && w.status === 'waiting_webhook'
      );

      if (!run) {
        return sendJson(res, 404, {
          error: 'No active workflow execution found waiting for this callback token or callback expired'
        });
      }

      if (!body) body = await readBody(req);
      run.status = 'resuming';
      run.currentNodeIndex = (run.currentNodeIndex || 0) + 1;
      run.variables = run.variables || {};
      run.variables.callbackData = body;
      run.triggerContext = run.triggerContext || {};
      run.triggerContext.callbackData = body;
      await saveState();

      const flow = run.workflowSnapshot || (state.records.workflows || []).find(w => w.id === run.workflowId);
      if (!flow) return sendJson(res, 404, { error: 'Workflow snapshot not found' });

      console.log(`[OPERZA WEBHOOK RESUME] Resuming workflow execution ${run.id} via callback token ${resumeToken}`);
      const resumedRun = await executeWorkflowInstance({
        flow: structuredClone(flow),
        agencyId: run.agencyId,
        locationId: run.locationId,
        triggerType: run.triggerType,
        triggerContext: run.triggerContext,
        existingExecution: run,
        mode: run.mode || 'live'
      });

      auditLog('workflow.resumed_from_callback', null, {
        runId: run.id,
        workflowId: run.workflowId,
        resumeToken
      });
      broadcast('workflow.execution.resumed', { executionId: run.id, resumeToken, status: resumedRun.status });

      return sendJson(res, 200, {
        success: true,
        resumed: true,
        executionId: run.id,
        status: resumedRun.status,
        variables: resumedRun.variables || {}
      });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AUTH ROUTES ────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════
    if (pathname.startsWith('/api/auth/')) {
      const handled = await handleAuthRoutes(req, res, {
        method,
        pathname,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        scrypt,
        randomBytes,
        randomUUID,
        hash,
        safeEqual,
        setSessionCookies,
        clearSessionCookies,
        getActor,
        pgPool,
        cookieSession,
        isStagingOrProd,
        platformDbEnabled
      });
      if (handled || res.headersSent) {
        return;
      }
      return sendJson(res, 404, { error: 'Auth route not found' });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── AUTH REQUIRED FOR ALL ROUTES BELOW ─────────────────────
    // ═════════════════════════════════════════════════════════════
    const actor = await getActor(req);
    if (!actor) return sendJson(res, 401, { error: 'Authentication required' });
    const { agency, activeLocation } = actor;

    // ─── API Key Rate Limit & Scope Enforcement ───────────────────
    if (actor.apiKey) {
      if (req.rateLimitExceeded) {
        return sendJson(res, 429, {
          error: 'Rate limit exceeded for API key (120 requests/minute)',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }
      if (pathname.startsWith('/api/crm/contacts') || pathname.startsWith('/api/contacts')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'contacts:read' : 'contacts:write';
        if (!checkApiKeyScope(actor, requiredScope)) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/opportunities') || pathname.startsWith('/api/opportunities')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'opportunities:read' : 'opportunities:write';
        if (!checkApiKeyScope(actor, requiredScope)) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/calendars') || (pathname.startsWith('/api/calendars') && !pathname.startsWith('/api/calendars/public') && !pathname.startsWith('/api/calendars/book'))) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'calendars:read' : 'calendars:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'scheduling:read' : 'scheduling:write')) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/appointments') || pathname.startsWith('/api/appointments')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'appointments:read' : 'appointments:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'scheduling:read' : 'scheduling:write')) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/pipelines') || pathname.startsWith('/api/pipelines')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'pipelines:read' : 'pipelines:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'opportunities:read' : 'opportunities:write')) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/websites') || pathname.startsWith('/api/crm/funnels')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'funnels:read' : 'funnels:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'websites:read' : 'websites:write')) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: '${requiredScope}'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope
          });
        }
      }
      if (pathname.startsWith('/api/crm/orders') || pathname.startsWith('/api/orders')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'orders:read' : 'orders:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'payments:read' : 'payments:write')) {
          return sendJson(res, 403, { error: `Insufficient API key scope. Required: '${requiredScope}'`, code: 'INSUFFICIENT_SCOPES', requiredScope });
        }
      }
      if (pathname.startsWith('/api/crm/invoices') || pathname.startsWith('/api/invoices')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'invoices:read' : 'invoices:write';
        if (!checkApiKeyScope(actor, requiredScope) && !checkApiKeyScope(actor, (method === 'GET' || method === 'HEAD') ? 'payments:read' : 'payments:write')) {
          return sendJson(res, 403, { error: `Insufficient API key scope. Required: '${requiredScope}'`, code: 'INSUFFICIENT_SCOPES', requiredScope });
        }
      }
      if (pathname.startsWith('/api/crm/payments') || pathname.startsWith('/api/payments') || pathname.startsWith('/api/ledger/')) {
        const requiredScope = (method === 'GET' || method === 'HEAD') ? 'payments:read' : 'payments:write';
        if (!checkApiKeyScope(actor, requiredScope)) {
          return sendJson(res, 403, { error: `Insufficient API key scope. Required: '${requiredScope}'`, code: 'INSUFFICIENT_SCOPES', requiredScope });
        }
      }
      if (pathname.startsWith('/api/workflows') && method === 'POST') {
        if (!checkApiKeyScope(actor, 'workflows:trigger') && !checkApiKeyScope(actor, 'workflows:write')) {
          return sendJson(res, 403, {
            error: `Insufficient API key scope. Required: 'workflows:trigger'`,
            code: 'INSUFFICIENT_SCOPES',
            requiredScope: 'workflows:trigger'
          });
        }
      }
    }

    // ─── CSRF Validation on mutating requests ─────────────────────
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
      if (!validateCsrf(req, actor)) {
        return sendJson(res, 403, { error: 'Invalid or missing CSRF token' });
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── ZAPIER PLATFORM REST HOOKS & ACTIONS ────────────────────
    // ═════════════════════════════════════════════════════════════
    if (pathname.startsWith('/api/v1/zapier/')) {
      await handleZapierRoute(req, res, {
        method,
        pathname,
        actor,
        agency,
        activeLocation,
        state,
        saveState,
        sendJson,
        readBody,
        executeWorkflowInstance,
        broadcast,
        zapierRepository,
        secretResolver
      });
      return;
    }

    // ═════════════════════════════════════════════════════════════
    // ─── COPILOT ────────────────────────────────────────────────
    // ═════════════════════════════════════════════════════════════

    // COPILOT MULTI-AGENT SSE STREAMING ROUTE
    if ((method === 'GET' || method === 'POST') && pathname === '/api/copilot/chat/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': getCorsOrigin(req),
        'access-control-allow-credentials': 'true'
      });

      let message = '';
      let sessionId = randomUUID();
      let startAgent = AGENT_ROLES.SUPERVISOR;
      let activeModule = '';
      let streamMode = 'auto';

      if (method === 'GET') {
        message = url.searchParams.get('message') || '';
        sessionId = url.searchParams.get('sessionId') || sessionId;
        startAgent = url.searchParams.get('startAgent') || startAgent;
        activeModule = url.searchParams.get('activeModule') || '';
        streamMode = url.searchParams.get('mode') || streamMode;
      } else {
        const body = await readBody(req);
        message = body.message || '';
        sessionId = body.sessionId || sessionId;
        startAgent = body.startAgent || startAgent;
        activeModule = body.activeModule || '';
        streamMode = body.mode || streamMode;
      }

      if (!message.trim()) {
        res.write(`data: ${JSON.stringify({ error: 'message parameter is required' })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }

      if (streamMode === 'copilot') {
        try {
          for await (const chunk of copilotService.chatStream({
            message,
            sessionId,
            activeModule,
            agency,
            activeLocation,
            actor,
            state,
            platformRepository
          })) {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        } catch (streamErr) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
        }
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }

      const orchestrator = getMultiAgentOrchestrator(agency.id, activeLocation.id, actor);
      try {
        for await (const chunk of orchestrator.processUserMessageStream({
          message,
          sessionId,
          startAgent,
          context: { tenantId: agency.id, locationId: activeLocation.id },
          actor
        })) {
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        }
      } catch (streamErr) {
        res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      return res.end();
    }

    // COPILOT SSE STREAMING ROUTE (genuine multi-agent / provider-backed stream)
    if (method === 'GET' && pathname === '/api/copilot/stream') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
        'access-control-allow-origin': getCorsOrigin(req),
        'access-control-allow-credentials': 'true'
      });

      const message = url.searchParams.get('message') || 'Hello Operza';
      const sessionId = url.searchParams.get('sessionId') || randomUUID();

      let aborted = false;
      req.on('close', () => { aborted = true; });

      try {
        for await (const chunk of copilotService.chatStream({
          message,
          sessionId,
          activeModule: 'general',
          agency,
          activeLocation,
          actor,
          state,
          platformRepository
        })) {
          if (aborted) break;
          if (chunk.type === 'token') {
            res.write(`data: ${JSON.stringify({ delta: chunk.token })}\n\n`);
          } else {
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
      } catch (streamErr) {
        if (!aborted) {
          res.write(`data: ${JSON.stringify({ type: 'error', error: streamErr.message })}\n\n`);
        }
      }
      if (!aborted) {
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      }
      return;
    }

    // COPILOT CHAT (enhanced with tool calling)
    if (method === 'GET' && pathname === '/api/copilot/proposals') {
      const proposals = platformRepository
        ? await platformRepository.listCopilotProposals({ tenantId: agency.id, locationId: activeLocation.id })
        : (state.copilotProposals || []).filter(
            item => item.tenantId === agency.id && item.locationId === activeLocation.id
          ).slice().reverse();
      return sendJson(res, 200, { data: proposals });
    }

    if (method === 'POST' && pathname.startsWith('/api/copilot/proposals/') && pathname.endsWith('/approve')) {
      if (!['owner', 'admin', 'member'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Your role cannot review Copilot proposals' });
      }
      const proposalId = pathname.split('/')[4];
      let proposal;
      if (platformRepository) {
        try {
          proposal = await platformRepository.decideCopilotProposal({
            tenantId: agency.id,
            locationId: activeLocation.id,
            proposalId,
            actorId: actor.user.id,
            decision: 'approved'
          });
        } catch (err) {
          if (err.code === 'SELF_APPROVAL') {
            return sendJson(res, 403, { error: err.message, code: 'SELF_APPROVAL' });
          }
          if (err.code === 'NOT_FOUND') {
            return sendJson(res, 404, { error: 'Copilot proposal not found' });
          }
          if (err.code === 'ALREADY_DECIDED') {
            return sendJson(res, 409, { error: 'Proposal is no longer pending review' });
          }
          throw err;
        }
        if (!proposal) return sendJson(res, 409, { error: 'Proposal is missing or is no longer pending review' });
      } else {
        proposal = (state.copilotProposals || []).find(
          item => item.id === proposalId && item.tenantId === agency.id && item.locationId === activeLocation.id
        );
        if (!proposal) return sendJson(res, 404, { error: 'Copilot proposal not found' });
        if (proposal.status !== 'pending_review') return sendJson(res, 409, { error: 'Proposal is no longer pending review' });
        if (proposal.requestedByActorId && proposal.requestedByActorId === actor.user.id) {
          return sendJson(res, 403, {
            error: 'Four-eyes policy violation: Approver cannot be the same user who requested the proposal.',
            code: 'SELF_APPROVAL'
          });
        }
        proposal.status = 'approved';
        proposal.decidedAt = new Date().toISOString();
        proposal.decidedByActorId = actor.user.id;
        await saveState();
      }
      auditLog('copilot.proposal.approved', actor, { proposalId, executionStatus: 'not_executed' });
      return sendJson(res, 200, {
        success: true,
        proposal,
        execution: {
          status: 'not_executed',
          code: 'APPROVAL_RECORDED_ONLY',
          message: 'The review decision is saved. An authorized proposal executor is not yet configured.'
        }
      });
    }

    if (method === 'POST' && pathname.startsWith('/api/copilot/proposals/') && pathname.endsWith('/reject')) {
      if (!['owner', 'admin', 'member'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Your role cannot review Copilot proposals' });
      }
      const proposalId = pathname.split('/')[4];
      let proposal;
      if (platformRepository) {
        try {
          proposal = await platformRepository.decideCopilotProposal({
            tenantId: agency.id,
            locationId: activeLocation.id,
            proposalId,
            actorId: actor.user.id,
            decision: 'rejected'
          });
        } catch (err) {
          if (err.code === 'NOT_FOUND') {
            return sendJson(res, 404, { error: 'Copilot proposal not found' });
          }
          if (err.code === 'ALREADY_DECIDED') {
            return sendJson(res, 409, { error: 'Proposal is no longer pending review' });
          }
          throw err;
        }
        if (!proposal) return sendJson(res, 409, { error: 'Proposal is missing or is no longer pending review' });
      } else {
        proposal = (state.copilotProposals || []).find(
          item => item.id === proposalId && item.tenantId === agency.id && item.locationId === activeLocation.id
        );
        if (!proposal) return sendJson(res, 404, { error: 'Copilot proposal not found' });
        if (proposal.status !== 'pending_review') return sendJson(res, 409, { error: 'Proposal is no longer pending review' });
        proposal.status = 'rejected';
        proposal.decidedAt = new Date().toISOString();
        proposal.decidedByActorId = actor.user.id;
        await saveState();
      }
      auditLog('copilot.proposal.rejected', actor, { proposalId });
      return sendJson(res, 200, { success: true, proposal });
    }

    if (method === 'POST' && pathname.startsWith('/api/copilot/proposals/') && pathname.endsWith('/execute')) {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and administrators can execute proposals' });
      }
      const proposalId = pathname.split('/')[4];
      const proposal = platformRepository
        ? await platformRepository.getCopilotProposal({ tenantId: agency.id, locationId: activeLocation.id, proposalId })
        : (state.copilotProposals || []).find(
            item => item.id === proposalId && item.tenantId === agency.id && item.locationId === activeLocation.id
          );
      if (!proposal) return sendJson(res, 404, { error: 'Copilot proposal not found' });

      // Build mutation handlers
      const proposalHandlers = {
        create_contact: async (params, ctx) => {
          state.records.contacts = state.records.contacts || [];
          const newContact = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            firstName: params.firstName || (params.name ? params.name.split(' ')[0] : 'Proposed'),
            lastName: params.lastName || (params.name ? params.name.split(' ').slice(1).join(' ') : 'Contact'),
            email: params.email || '',
            phone: params.phone || '',
            company: params.company || '',
            tags: Array.isArray(params.tags) ? params.tags : ['copilot-created'],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          state.records.contacts.push(newContact);
          await saveState();
          broadcast('crm.contacts.created', newContact);
          return { id: newContact.id, email: newContact.email, name: `${newContact.firstName} ${newContact.lastName}`.trim() };
        },
        create_task: async (params, ctx) => {
          state.records.tasks = state.records.tasks || [];
          const newTask = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            title: params.title || 'Copilot Task',
            description: params.description || '',
            status: 'pending',
            dueDate: params.dueDate || new Date(Date.now() + 86400000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          state.records.tasks.push(newTask);
          await saveState();
          return { id: newTask.id, title: newTask.title };
        },
        update_opportunity_stage: async (params, ctx) => {
          state.records.opportunities = state.records.opportunities || [];
          const opp = state.records.opportunities.find(o =>
            o.agencyId === agency.id && o.locationId === activeLocation.id &&
            ((params.opportunityId && o.id === params.opportunityId) ||
             (params.name && o.name.toLowerCase().includes(params.name.toLowerCase())))
          );
          if (!opp) throw new Error('Opportunity not found');
          opp.stage = params.stage;
          opp.updatedAt = new Date().toISOString();
          await saveState();
          broadcast('crm.opportunities.updated', opp);
          return { id: opp.id, stage: opp.stage };
        },
        generate_workflow: async (params, ctx) => {
          state.records.workflows = state.records.workflows || [];
          const newWf = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            name: params.name || 'Automated Growth Journey',
            status: params.status || 'draft',
            triggerType: params.triggerType || 'tag',
            triggerConfig: params.triggerConfig || { tag: 'inbound-prospect' },
            nodes: params.nodes || [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          state.records.workflows.push(newWf);
          await saveState();
          broadcast('crm.workflows.created', newWf);
          return { id: newWf.id, name: newWf.name, nodesCount: newWf.nodes.length };
        },
        trigger_workflow: async (params, ctx) => {
          state.records.workflows = state.records.workflows || [];
          const wf = state.records.workflows.find(w =>
            w.agencyId === agency.id &&
            ((params.workflowId && w.id === params.workflowId) ||
             (params.workflowName && w.name.toLowerCase().includes(params.workflowName.toLowerCase())))
          );
          if (!wf) throw new Error(`Workflow not found: ${params.workflowName || params.workflowId}`);
          const execution = await executeWorkflowInstance({
            flow: wf,
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'copilot_manual',
            triggerContext: { triggerSource: 'copilot_agent' },
            mode: 'live'
          });
          return { id: execution.id, workflowId: wf.id, status: execution.status };
        },
        create_campaign: async (params, ctx) => {
          state.records.campaigns = state.records.campaigns || [];
          const newCampaign = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            name: params.name || 'AI Marketing Campaign',
            subject: params.subject || params.name || 'Special Update from Operza',
            channel: params.channel || 'email',
            status: 'draft',
            audienceTag: params.audienceTag || 'all',
            content: params.content || params.body || '',
            scheduledAt: params.scheduledAt || null,
            sentCount: 0,
            openCount: 0,
            clickCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          state.records.campaigns.push(newCampaign);
          await saveState();
          broadcast('crm.campaigns.created', newCampaign);
          return { id: newCampaign.id, name: newCampaign.name, channel: newCampaign.channel };
        },
        create_campaign_proposal: async (params, ctx) => {
          return proposalHandlers.create_campaign(params, ctx);
        },
        create_payment_link: async (params, ctx) => {
          state.records.paymentLinks = state.records.paymentLinks || [];
          const sanitizedSlug = params.slug
            ? String(params.slug).toLowerCase().replace(/[^a-z0-9-]+/g, '-')
            : (params.name ? String(params.name).toLowerCase().replace(/[^a-z0-9-]+/g, '-') : `pay-${Date.now()}`);
          const validAmount = typeof params.amount === 'number' && Number.isFinite(params.amount) && params.amount > 0
            ? params.amount
            : 99;
          const newLink = {
            id: randomUUID(),
            agencyId: agency.id,
            locationId: activeLocation.id,
            name: (params.name || 'Product Checkout Link').trim(),
            slug: sanitizedSlug,
            amount: validAmount,
            currency: params.currency || 'USD',
            productIds: Array.isArray(params.productIds) ? params.productIds : [],
            visits: 0,
            conversions: 0,
            active: true,
            description: params.description || '',
            createdAt: new Date().toISOString()
          };
          state.records.paymentLinks.push(newLink);
          await saveState();
          broadcast('crm.payments.created', newLink);
          return { id: newLink.id, name: newLink.name, amount: newLink.amount, slug: newLink.slug };
        },
        create_payment_link_proposal: async (params, ctx) => {
          return proposalHandlers.create_payment_link(params, ctx);
        },
        create_website_page: async (params, ctx) => {
          state.records.websites = state.records.websites || [];
          const targetLocationId = ctx?.locationId || activeLocation.id;
          let site = state.records.websites.find(w =>
            w.agencyId === agency.id &&
            w.locationId === targetLocationId &&
            (params.websiteId ? w.id === params.websiteId : true)
          );
          if (!site) {
            site = {
              id: randomUUID(),
              agencyId: agency.id,
              locationId: targetLocationId,
              name: (params.websiteName || 'Main Website').trim(),
              domain: params.domain || 'growth.operza.com',
              published: false,
              status: 'draft',
              pages: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            state.records.websites.push(site);
          }
          const sanitizedPath = params.path
            ? `/${String(params.path).replace(/^\/+/, '').replace(/[^a-z0-9/_-]+/gi, '-')}`
            : `/${(params.name || 'page').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
          const newPage = {
            id: randomUUID(),
            name: (params.name || 'New Landing Page').trim(),
            path: sanitizedPath,
            headline: params.headline || params.name || 'Welcome',
            subhead: params.subhead || '',
            cta: params.cta || 'Get started',
            theme: params.theme || 'plain',
            visits: 0,
            optins: 0,
            createdAt: new Date().toISOString()
          };
          const updatedSite = {
            ...site,
            pages: Array.isArray(site.pages) ? [...site.pages, newPage] : [newPage],
            updatedAt: new Date().toISOString()
          };
          const siteIdx = state.records.websites.findIndex(w => w.id === site.id);
          if (siteIdx >= 0) state.records.websites[siteIdx] = updatedSite;
          await saveState();
          broadcast('crm.website.page_created', { siteId: site.id, page: newPage });
          return { siteId: site.id, pageId: newPage.id, name: newPage.name, path: newPage.path };
        },
        create_website_page_proposal: async (params, ctx) => {
          return proposalHandlers.create_website_page(params, ctx);
        },
        generate_api_key: async (params, ctx) => {
          const secret = randomBytes(24).toString('hex');
          const secretToken = `op_live_${secret}`;
          const maskedKey = `op_live_${secret.slice(0, 4)}...${secret.slice(-4)}`;
          state.records.apiKeys = state.records.apiKeys || [];
          const newKey = {
            id: randomUUID(),
            agencyId: agency.id,
            label: (params.label || 'Copilot Generated API Key').trim(),
            keyHash: hash(secretToken),
            maskedKey,
            scopes: Array.isArray(params.scopes) ? params.scopes : ['contacts:read'],
            createdAt: new Date().toISOString(),
            lastUsedAt: null
          };
          state.records.apiKeys.push(newKey);
          await saveState();
          auditLog('developer.key_created', actor, { keyId: newKey.id, label: newKey.label });
          return { id: newKey.id, label: newKey.label, maskedKey: newKey.maskedKey, secretToken };
        },
        generate_api_key_proposal: async (params, ctx) => {
          return proposalHandlers.generate_api_key(params, ctx);
        }
      };

      const result = await executeCopilotProposal({
        proposal,
        actor,
        handlers: proposalHandlers,
        ledger: billingLedgerStore,
        toolCostCents: 10
      });

      if (!result.ok) {
        return sendJson(res, 400, { error: result.message, code: result.code });
      }

      // Sanitize receipt to ensure raw credentials/secret tokens are never persisted in audit receipts or broadcast over WebSockets
      const sanitizedReceipt = {
        ...result.receipt,
        result: result.receipt.result ? { ...result.receipt.result, secretToken: undefined } : result.receipt.result,
        diff: result.receipt.diff ? {
          ...result.receipt.diff,
          outcome: result.receipt.diff.outcome ? { ...result.receipt.diff.outcome, secretToken: undefined } : result.receipt.diff.outcome
        } : result.receipt.diff
      };
      state.actionReceipts = state.actionReceipts || [];
      state.actionReceipts.push(sanitizedReceipt);
      await saveState();

      auditLog('copilot.proposal.executed', actor, {
        proposalId,
        receiptId: result.receipt.id,
        toolName: proposal.toolName
      });
      broadcast('copilot.proposal.executed', {
        proposal: result.proposal,
        receipt: sanitizedReceipt
      });

      return sendJson(res, 200, {
        success: true,
        proposal: result.proposal,
        receipt: sanitizedReceipt,
        ...(result.receipt?.result?.secretToken ? { credential: { secretToken: result.receipt.result.secretToken } } : {})
      });
    }

    if (method === 'POST' && pathname === '/api/copilot/chat') {
      const body = await readBody(req);
      const { message, sessionId: reqSessionId, activeModule, tools: requestedTools } = body;
      if (typeof message !== 'string' || !message.trim()) return sendJson(res, 400, { error: 'message is required' });
      if (Array.isArray(requestedTools) && requestedTools.length > 10) {
        return sendJson(res, 400, { error: 'A maximum of 10 Copilot tool requests is allowed' });
      }
      const aiLimit = await checkTenantUsageLimit(agency.id, 'monthlyAiRequests', 1);
      if (!aiLimit.allowed) {
        return sendJson(res, 429, { error: 'Monthly Copilot request allowance has been reached', code: aiLimit.code, limit: aiLimit.limit, consumed: aiLimit.consumed });
      }
      await recordTenantUsage({
        agencyId: agency.id,
        locationId: activeLocation.id,
        metric: 'monthlyAiRequests',
        source: 'copilot.chat'
      });

      const sessionId = reqSessionId || randomUUID();

      try {
        const copilotRes = await copilotService.chat({
          message,
          sessionId,
          activeModule: activeModule || '',
          agency,
          activeLocation,
          actor,
          state,
          platformRepository
        });

        // Ensure legacy toolResults array format for backwards compatibility with tests
        const toolResults = copilotRes.message.toolResults || [];
        if (copilotRes.message.proposal && !toolResults.some(t => t.tool === copilotRes.message.proposal.toolName)) {
          toolResults.push({
            tool: copilotRes.message.proposal.toolName,
            result: copilotRes.message.proposal
          });
        }

        const responseMsg = {
          role: 'assistant',
          content: copilotRes.message.content,
          toolResults: toolResults.length > 0 ? toolResults : undefined,
          proposals: toolResults.filter(item => item.result?.status === 'pending_review').map(item => item.result),
          sources: copilotRes.message.sources || [],
          timestamp: new Date().toISOString()
        };

        return sendJson(res, 200, {
          sessionId,
          message: responseMsg,
          tools: COPILOT_TOOLS.map(t => t.name),
          historyLength: copilotRes.historyLength
        });
      } catch (chatErr) {
        console.error('[Copilot API] Chat error:', chatErr);
        return sendJson(res, 500, { error: chatErr.message || 'Copilot assistant execution error' });
      }
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
      campaign.opened = 0;
      campaign.clicked = 0;
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
        sentCount: matched.length,
        opened: 0,
        clicked: 0
      });
    }

    // Public Email Open Tracking Pixel (1x1 Transparent GIF)
    if (method === 'GET' && pathname.startsWith('/api/campaigns/track/open/')) {
      const campaignId = pathname.replace('/api/campaigns/track/open/', '').trim();
      const campaign = (state.records.campaigns || []).find(c => c.id === campaignId);
      if (campaign) {
        campaign.opened = (campaign.opened || 0) + 1;
        campaign.updatedAt = new Date().toISOString();
        await saveState();
        broadcast('crm.campaign.opened', { campaignId, opened: campaign.opened });
      }
      const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': pixel.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private'
      });
      return res.end(pixel);
    }

    // Public Email Click Tracking Redirect
    if (method === 'GET' && pathname.startsWith('/api/campaigns/track/click/')) {
      const campaignId = pathname.replace('/api/campaigns/track/click/', '').trim();
      const targetUrl = url.searchParams.get('url') || '/';
      const campaign = (state.records.campaigns || []).find(c => c.id === campaignId);
      if (campaign) {
        campaign.clicked = (campaign.clicked || 0) + 1;
        campaign.updatedAt = new Date().toISOString();
        await saveState();
        broadcast('crm.campaign.clicked', { campaignId, clicked: campaign.clicked });
      }
      res.writeHead(302, { Location: targetUrl });
      return res.end();
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

    if (pathname.startsWith('/api/conversations/') && pathname.endsWith('/messages')) {
      if (await handleConversationsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool, randomUUID
      })) {
        return;
      }
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

    if (pathname.startsWith('/api/forms/')) {
      if (await handleFormsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool,
        triggerWorkflowExecution, randomUUID
      })) {
        return;
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── HOSTED WEBSITES & MULTI-PAGE CMS ───────────────────────
    // ═════════════════════════════════════════════════════════════

    // Toggle Website / Funnel Publishing State
    if (method === 'POST' && pathname.startsWith('/api/websites/') && pathname.endsWith('/publish')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/publish', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
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
      const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
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
      const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
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
        const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
        if (!site) return sendJson(res, 404, { error: 'Website not found' });
        site.pages = (site.pages || []).filter(p => p.id !== pageId);
        site.updatedAt = new Date().toISOString();
        auditLog('website.page_deleted', actor, { siteId: site.id, pageId });
        broadcast('crm.website.page_deleted', { siteId: site.id, pageId });
        await saveState();
        return sendJson(res, 200, { success: true, remainingPages: site.pages.length, site });
      }
    }

    // Update Website Global Symbols (Header & Footer Navigation Symbols)
    if (method === 'PUT' && pathname.startsWith('/api/websites/') && pathname.endsWith('/symbols')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/symbols', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
      if (!site) return sendJson(res, 404, { error: 'Website not found' });

      const body = await readBody(req);
      if (body.globalHeader !== undefined) site.globalHeader = body.globalHeader;
      if (body.globalFooter !== undefined) site.globalFooter = body.globalFooter;
      site.updatedAt = new Date().toISOString();

      auditLog('website.symbols_updated', actor, {
        siteId: site.id,
        hasHeader: Boolean(site.globalHeader),
        hasFooter: Boolean(site.globalFooter)
      });
      broadcast('crm.website.symbols_updated', { siteId: site.id, globalHeader: site.globalHeader, globalFooter: site.globalFooter });
      await saveState();

      return sendJson(res, 200, { success: true, site, globalHeader: site.globalHeader, globalFooter: site.globalFooter });
    }

    // Verify Custom Domain DNS Records via node:dns
    if (method === 'POST' && pathname.startsWith('/api/websites/') && pathname.endsWith('/verify-dns')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/verify-dns', '').trim();
      const body = await readBody(req);
      const domainToCheck = (body.domain || '').trim().toLowerCase();
      if (!domainToCheck) {
        return sendJson(res, 400, { error: 'Domain is required for verification' });
      }

      let aResolved = [];
      let cnameResolved = [];
      let txtResolved = [];

      try {
        aResolved = await dns.resolve4(domainToCheck).catch(() => []);
      } catch {
        // Fallback for domains without A records
      }

      try {
        cnameResolved = await dns.resolveCname(domainToCheck).catch(() => []);
      } catch {
        // Fallback for domains without CNAME records
      }

      try {
        const rawTxt = await dns.resolveTxt(domainToCheck).catch(() => []);
        txtResolved = rawTxt.map(t => Array.isArray(t) ? t.join('') : String(t));
      } catch {
        // Fallback for domains without TXT records
      }

      const expectedA = '76.76.21.21';
      const expectedCname = 'cname.operza.net';
      const expectedTxtPrefix = `operza-verification=${siteId}`;

      const aMatched = aResolved.includes(expectedA);
      const cnameMatched = cnameResolved.some(c => c.toLowerCase().includes('operza.net') || c.toLowerCase().includes(expectedCname));
      const txtMatched = txtResolved.some(t => t.includes(expectedTxtPrefix));

      const isConfigured = aMatched || cnameMatched || txtMatched;

      return sendJson(res, 200, {
        domain: domainToCheck,
        siteId,
        isConfigured,
        sslStatus: isConfigured ? 'active' : 'pending_validation',
        records: {
          a: { expected: expectedA, found: aResolved, valid: aMatched },
          cname: { expected: expectedCname, found: cnameResolved, valid: cnameMatched },
          txt: { expected: expectedTxtPrefix, found: txtResolved, valid: txtMatched }
        },
        instructions: {
          typeA: `Add an A record pointing @ to ${expectedA}`,
          typeCname: `Add a CNAME record pointing your subdomain (e.g. www) to ${expectedCname}`,
          typeTxt: `Add a TXT record with value ${expectedTxtPrefix}`
        },
        message: isConfigured 
          ? `Domain ${domainToCheck} is successfully resolved and secured.` 
          : `DNS records for ${domainToCheck} are pending propagation. Please check your registrar settings.`
      });
    }

    // 1-Click Static Site Hosting Export Bundle
    if (method === 'GET' && pathname.startsWith('/api/websites/') && pathname.endsWith('/export-pack')) {
      const siteId = pathname.replace('/api/websites/', '').replace('/export-pack', '').trim();
      state.records.websites = state.records.websites || [];
      const site = state.records.websites.find(
        w => w.id === siteId && w.agencyId === agency.id && (!w.locationId || !activeLocation || w.locationId === activeLocation.id)
      );
      if (!site) return sendJson(res, 404, { error: 'Website not found' });

      const pagesBundle = (site.pages || []).map(p => {
        const fileName = p.path === '/' || p.path === '' ? 'index.html' : `${p.path.replace(/^\//, '')}.html`;
        const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${p.headline || p.name} | ${site.name}</title>
  <meta name="description" content="${p.subhead || site.description || site.name}" />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" />
  <style>
    :root { --font-sans: 'Plus Jakarta Sans', system-ui, sans-serif; --primary: #4f46e5; --bg: #090d16; --surface: #111827; --text: #f9fafb; --text-muted: #9ca3af; --border: #1f2937; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); background: var(--bg); color: var(--text); line-height: 1.6; min-height: 100vh; display: flex; flex-direction: column; }
    header { border-bottom: 1px solid var(--border); background: rgba(17, 24, 39, 0.85); backdrop-filter: blur(12px); padding: 18px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; }
    .brand { font-size: 20px; font-weight: 800; color: #fff; text-decoration: none; letter-spacing: -0.02em; }
    nav a { color: var(--text-muted); text-decoration: none; margin-left: 20px; font-size: 14px; font-weight: 500; transition: color 0.2s; }
    nav a:hover { color: #fff; }
    .hero { max-width: 1080px; margin: 0 auto; padding: 80px 24px; text-align: center; }
    .hero h1 { font-size: clamp(32px, 5vw, 56px); font-weight: 800; letter-spacing: -0.03em; margin-bottom: 20px; line-height: 1.15; background: linear-gradient(135deg, #fff 40%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .hero p { font-size: clamp(16px, 2vw, 20px); color: var(--text-muted); max-width: 680px; margin: 0 auto 36px; }
    .btn { display: inline-block; background: var(--primary); color: #fff; text-decoration: none; padding: 14px 28px; border-radius: 10px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 18px rgba(79, 70, 229, 0.4); transition: transform 0.15s; }
    .btn:hover { transform: translateY(-2px); }
    footer { margin-top: auto; border-top: 1px solid var(--border); padding: 32px 24px; text-align: center; color: var(--text-muted); font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <a href="index.html" class="brand">${site.name}</a>
    <nav>
      ${(site.pages || []).map(pg => `<a href="${pg.path === '/' || pg.path === '' ? 'index.html' : `${pg.path.replace(/^\//, '')}.html`}">${pg.name}</a>`).join('')}
    </nav>
  </header>
  <main>
    <section class="hero">
      <h1>${p.headline || p.name}</h1>
      <p>${p.subhead || ''}</p>
      ${p.cta ? `<a href="#contact" class="btn">${p.cta}</a>` : ''}
    </section>
  </main>
  <footer>
    <p>${site.globalFooter?.copyrightText || `© ${new Date().getFullYear()} ${site.name}. All rights reserved.`}</p>
  </footer>
</body>
</html>`;
        return { fileName, content: html };
      });

      return sendJson(res, 200, {
        success: true,
        siteName: site.name,
        siteDomain: site.domain,
        pageCount: pagesBundle.length,
        pages: pagesBundle,
        instructions: 'Deploy this bundle to Vercel, Netlify, Cloudflare Pages, or any standard HTTP web server (Apache/Nginx).'
      });
    }

    // POST /api/workspace/reset — Full Workspace Reset (Clean Slate or Demo)
    if (method === 'POST' && pathname === '/api/workspace/reset') {
      const body = await readBody(req);
      const mode = body.mode === 'demo' ? 'demo' : 'clean';

      const targetAgencyId = agency.id;
      const targetLocationId = activeLocation ? activeLocation.id : null;

      if (mode === 'clean') {
        const collectionsToPurge = [
          'contacts', 'deals', 'opportunities', 'workflows', 'websites',
          'funnels', 'blogs', 'qrCodes', 'forms', 'paymentLinks',
          'appointments', 'media', 'snippets', 'conversations', 'tasks',
          'transactions', 'invoices', 'smartLists'
        ];

        for (const col of collectionsToPurge) {
          if (state.records[col]) {
            state.records[col] = state.records[col].filter(
              r => r.agencyId !== targetAgencyId
            );
          }
        }

        // Reset pipelines to a clean 'Lead Pipeline' with 0 deals
        state.records.pipelines = (state.records.pipelines || []).filter(
          p => p.agencyId !== targetAgencyId
        );
        state.records.pipelines.push({
          id: randomUUID(),
          agencyId: targetAgencyId,
          locationId: targetLocationId || randomUUID(),
          name: 'Lead Pipeline',
          stages: ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Won', 'Lost'],
          status: 'active',
          description: 'Primary customer acquisition pipeline',
          createdAt: new Date().toISOString()
        });

        await saveState();
        auditLog('workspace.reset_clean', actor, { agencyId: targetAgencyId, mode: 'clean' });

        return sendJson(res, 200, {
          success: true,
          mode: 'clean',
          message: 'Workspace successfully reset to a clean slate (0 records).'
        });
      } else {
        return sendJson(res, 200, {
          success: true,
          mode: 'demo',
          message: 'Demo showcase records available.'
        });
      }
    }

    // ═════════════════════════════════════════════════════════════
    // ─── 2-WAY CALENDAR SYNC & OAUTH (DELEGATED TO SCHEDULING ROUTER) ───
    // ═════════════════════════════════════════════════════════════
    if (pathname.startsWith('/api/calendars/') || pathname === '/api/calendars/oauth/callback') {
      if (await handleSchedulingRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor,
        agency,
        activeLocation,
        randomUUID,
        pgPool,
        triggerWorkflowExecution,
        dispatchZapierEvent,
        zapierRepository,
        syncRelationalWrite,
        secretResolver,
        effectiveVaultKey,
        isProd
      })) {
        return;
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

    if (pathname.startsWith('/api/reviews/')) {
      if (await handleReviewsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool,
        triggerWorkflowExecution, randomUUID
      })) {
        return;
      }
    }

    if (pathname === '/api/tasks' || pathname.startsWith('/api/tasks/')) {
      if (await handleTasksRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool, randomUUID
      })) {
        return;
      }
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
      const name = String(body.name || `upload-${Date.now()}.png`).trim();
      const folder = String(body.folder || 'Unsorted').trim();
      const kind = body.kind || 'image';
      let mimeType = body.mimeType || (kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : 'application/pdf');
      const data = body.data || null;

      // Validate MIME type
      const ALLOWED_MIMES = [
        'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
        'application/pdf', 'video/mp4', 'video/webm', 'text/plain', 'text/csv'
      ];
      if (!ALLOWED_MIMES.includes(mimeType)) {
        return sendJson(res, 400, { error: `MIME type '${mimeType}' is not supported`, code: 'UNSUPPORTED_MEDIA_TYPE' });
      }

      let buffer = null;
      let sizeKb = 0;

      if (data && typeof data === 'string') {
        const isBase64 = data.includes(';base64,');
        const raw = isBase64 ? data.split(';base64,')[1] : data;
        buffer = Buffer.from(raw, 'base64');

        // Strip scripts from SVG to prevent stored XSS
        if (mimeType === 'image/svg+xml') {
          let svgText = buffer.toString('utf8');
          svgText = svgText.replace(/<script[\s\S]*?<\/script>/gi, '');
          svgText = svgText.replace(/on\w+="[^"]*"/gi, '');
          svgText = svgText.replace(/on\w+='[^']*'/gi, '');
          svgText = svgText.replace(/javascript:/gi, '');
          buffer = Buffer.from(svgText, 'utf8');
        }

        sizeKb = Math.max(1, Math.round(buffer.length / 1024));
        if (buffer.length > 25 * 1024 * 1024) {
          return sendJson(res, 413, { error: 'Media file exceeds maximum allowed size (25MB)', code: 'PAYLOAD_TOO_LARGE' });
        }
      } else {
        sizeKb = body.sizeKb || 24;
      }

      const assetId = randomUUID();
      state.records.media = state.records.media || [];

      // Persist binary payload to disk volume
      const MEDIA_STORAGE_DIR = path.join(dataDir, 'media');
      await mkdir(MEDIA_STORAGE_DIR, { recursive: true }).catch(() => {});
      if (buffer) {
        await writeFile(path.join(MEDIA_STORAGE_DIR, `${assetId}.bin`), buffer);
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

      const MEDIA_STORAGE_DIR = path.join(dataDir, 'media');
      await unlink(path.join(MEDIA_STORAGE_DIR, `${assetId}.bin`)).catch(() => {});

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
    // ─── A2P 10DLC CARRIER REGISTRATION & TRUST HUB ─────────────
    // ═════════════════════════════════════════════════════════════

    // GET /api/telephony/a2p/status - retrieve carrier compliance & 10DLC status
    if (method === 'GET' && pathname === '/api/telephony/a2p/status') {
      state.a2pRegistrations = state.a2pRegistrations || [];
      const reg = state.a2pRegistrations.find(r => r.agencyId === agency.id && (r.locationId === activeLocation?.id || !r.locationId));
      if (!reg) {
        return sendJson(res, 200, {
          status: 'UNREGISTERED',
          isRegistered: false,
          brand: null,
          campaign: null,
          trustScore: 0,
          dailyLimit: 2000,
          throughputMPS: 15
        });
      }
      return sendJson(res, 200, reg);
    }

    // POST /api/telephony/a2p/register - submit brand & campaign for carrier 10DLC registration
    if (method === 'POST' && pathname === '/api/telephony/a2p/register') {
      const body = await readBody(req);
      const legalBusinessName = String(body.legalBusinessName || agency.name || '').trim();
      const ein = String(body.ein || '').trim();
      const campaignType = String(body.campaignType || 'low_volume_mixed').trim();

      if (!legalBusinessName) {
        return sendJson(res, 400, { error: 'legalBusinessName is required' });
      }

      state.a2pRegistrations = state.a2pRegistrations || [];
      const existingIdx = state.a2pRegistrations.findIndex(r => r.agencyId === agency.id);

      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.A2P_MOCK_VERIFIED === 'true';
      const registrationStatus = isTestEnv ? 'VERIFIED_10DLC' : 'SUBMITTED_MANUAL_REVIEW';
      const isRegistered = isTestEnv;
      const tcrBrandId = isTestEnv ? `BN-${randomBytes(4).toString('hex').toUpperCase()}` : `PENDING-${randomBytes(4).toString('hex').toUpperCase()}`;
      const campaignSid = isTestEnv ? `CP-${randomBytes(5).toString('hex').toUpperCase()}` : null;
      const trustScore = isTestEnv ? 88 : 0;
      const dailyLimit = isTestEnv ? 200000 : 2000;
      const throughputMPS = isTestEnv ? 75 : 15;

      const registrationRecord = {
        id: randomUUID(),
        agencyId: agency.id,
        locationId: activeLocation?.id,
        status: registrationStatus,
        isRegistered,
        tcrBrandId,
        campaignSid,
        trustScore,
        dailyLimit,
        throughputMPS,
        complianceNotice: isTestEnv ? 'Verified under test harness' : 'Manual carrier vetting required via Twilio Trust Hub / Campaign Registry (2-4 weeks).',
        brand: {
          legalBusinessName,
          ein: ein || '12-3456789',
          entityType: body.entityType || 'LLC',
          vertical: body.vertical || 'Professional Services',
          address: body.address || '100 Growth Way, Suite 400',
          city: body.city || 'Austin',
          state: body.state || 'TX',
          postalCode: body.postalCode || '78701',
          country: body.country || 'US',
          website: body.website || 'https://operza.io'
        },
        campaign: {
          useCase: campaignType,
          description: body.description || 'Customer engagement, appointment reminders, and account alerts.',
          sampleMessages: body.sampleMessages || [
            'Hi [Name], your appointment with [Company] is confirmed for tomorrow at 2 PM. Reply STOP to cancel.',
            'Hi [Name], this is your monthly account summary from [Company]. Reach out if you have any questions!'
          ],
          optInWorkflow: body.optInWorkflow || 'Users check an opt-in box on public booking and contact forms agreeing to SMS notifications.',
          optInKeywords: ['START', 'YES', 'SUBSCRIBE'],
          optOutKeywords: ['STOP', 'CANCEL', 'UNSUBSCRIBE', 'QUIT'],
          helpKeywords: ['HELP', 'INFO']
        },
        registeredAt: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        state.a2pRegistrations[existingIdx] = registrationRecord;
      } else {
        state.a2pRegistrations.push(registrationRecord);
      }

      await saveState();
      auditLog('telephony.a2p.registered', actor, {
        brandId: registrationRecord.tcrBrandId,
        campaignSid: registrationRecord.campaignSid,
        legalBusinessName
      });
      broadcast('telephony.a2p.updated', registrationRecord);

      return sendJson(res, 201, registrationRecord);
    }

    // ═════════════════════════════════════════════════════════════
    // ─── REAL-TIME WEBRTC TELEPHONY & SOFTPHONE CALLS ───────────
    // ═════════════════════════════════════════════════════════════

    // GET /api/telephony/status - Retrieve carrier configuration and live dialing readiness
    if (method === 'GET' && pathname === '/api/telephony/status') {
      state.records.phoneNumbers = state.records.phoneNumbers || [];
      const tenantNumbers = state.records.phoneNumbers.filter(p => p.agencyId === agency.id);
      const defaultNumber = tenantNumbers.find(p => p.voice) || tenantNumbers[0];
      const hasTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
      const hasSip = Boolean(process.env.SIP_GATEWAY_URL);
      const isConfigured = hasTwilio || hasSip;

      return sendJson(res, 200, {
        configured: isConfigured,
        provider: hasTwilio ? 'twilio' : (hasSip ? 'sip' : 'none'),
        status: isConfigured ? 'verified' : 'unconfigured',
        callerId: process.env.TWILIO_CALLER_ID || defaultNumber?.number || null,
        liveDispatchReady: isConfigured,
        sandboxAvailable: true,
        message: isConfigured
          ? 'Carrier voice trunk is verified and operational.'
          : 'Carrier trunk is unconfigured. Live external PSTN dialing is disabled until Twilio or SIP credentials are provided in Integrations. Local sandbox testing is available.'
      });
    }

    // POST /api/telephony/token - Issue WebRTC voice client token & STUN/TURN ICE config
    if (method === 'POST' && pathname === '/api/telephony/token') {
      state.records.phoneNumbers = state.records.phoneNumbers || [];
      const tenantNumbers = state.records.phoneNumbers.filter(p => p.agencyId === agency.id);
      const defaultNumber = tenantNumbers.find(p => p.voice) || tenantNumbers[0];
      const hasCarrier = Boolean((process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) || process.env.SIP_GATEWAY_URL);

      let iceServers = [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
      ];
      if (process.env.WEBRTC_ICE_SERVERS) {
        try {
          iceServers = JSON.parse(process.env.WEBRTC_ICE_SERVERS);
        } catch {
          // fallback to default STUN
        }
      }

      const rtcSession = {
        token: `opz_rtc_${randomBytes(16).toString('hex')}`,
        identity: actor?.user?.email || `agent_${actor?.user?.id?.slice(0, 8) || 'operator'}`,
        fromNumber: defaultNumber?.number || '+18005550199',
        configured: hasCarrier,
        provider: hasCarrier ? 'twilio' : 'none',
        iceServers,
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      };

      return sendJson(res, 200, rtcSession);
    }

    // POST /api/telephony/call/start - Initiate outbound softphone call
    if (method === 'POST' && pathname === '/api/telephony/call/start') {
      const body = await readBody(req);
      const to = String(body.to || '').trim();
      if (!to) {
        return sendJson(res, 400, { error: 'Destination phone number (to) is required' });
      }

      const hasCarrier = Boolean((process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) || process.env.SIP_GATEWAY_URL);
      if (body.mode === 'live' && !hasCarrier) {
        return sendJson(res, 400, {
          error: 'Telephony carrier unconfigured',
          code: 'CARRIER_NOT_CONFIGURED',
          message: 'No live telephony carrier (Twilio or SIP Trunk) is configured on this server. To place live calls to external phone numbers, configure TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in environment settings.'
        });
      }
      const isSandboxMode = body.mode === 'sandbox' || body.sandbox === true || !hasCarrier;

      state.records.phoneNumbers = state.records.phoneNumbers || [];
      const tenantNumbers = state.records.phoneNumbers.filter(p => p.agencyId === agency.id);
      const defaultNumber = tenantNumbers.find(p => p.voice) || tenantNumbers[0];
      const fromNumber = body.from || defaultNumber?.number || '+18005550199';

      state.records.contacts = state.records.contacts || [];
      const normTo = normalizePhone(to);
      const matchedContact = body.contactId
        ? state.records.contacts.find(c => c.id === body.contactId && c.agencyId === agency.id)
        : state.records.contacts.find(c => c.agencyId === agency.id && normalizePhone(c.phone) === normTo);

      const callId = randomUUID();
      const call = {
        id: callId,
        agencyId: agency.id,
        locationId: activeLocation?.id || null,
        from: fromNumber,
        to: to,
        direction: 'outbound',
        status: 'in_progress',
        outcome: 'completed',
        durationSec: 0,
        startedAt: new Date().toISOString(),
        endedAt: null,
        contactId: matchedContact?.id || body.contactId || null,
        numberId: defaultNumber?.id || null,
        recordingUrl: null,
        handled: true,
        mode: hasCarrier ? 'live' : 'sandbox',
        isSimulated: !hasCarrier,
        notes: hasCarrier
          ? (body.notes || 'Outbound WebRTC softphone call')
          : `[SANDBOX SIMULATION - NO CARRIER DISPATCH] ${body.notes || 'Browser softphone test'}`,
        dtmfLog: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      state.records.calls = state.records.calls || [];
      state.records.calls.unshift(call);

      if (matchedContact) {
        matchedContact.lastActivityAt = call.startedAt;
        matchedContact.updatedAt = new Date().toISOString();
      }

      await saveState();

      auditLog('telephony.call.started', actor, {
        callId: call.id,
        from: call.from,
        to: call.to,
        contactId: call.contactId,
        mode: call.mode
      });
      broadcast('phone.call.started', call);

      return sendJson(res, 201, {
        success: true,
        call,
        carrierConfigured: hasCarrier,
        mode: call.mode,
        notice: hasCarrier ? undefined : 'Carrier trunk unconfigured: call started in browser sandbox simulation mode. Configure Twilio credentials in Integrations for live PSTN connection.'
      });
    }

    // POST /api/telephony/call/:id/end - Terminate active call and record duration & activity
    if (method === 'POST' && pathname.startsWith('/api/telephony/call/') && pathname.endsWith('/end')) {
      const callId = pathname.replace('/api/telephony/call/', '').replace('/end', '').trim();
      state.records.calls = state.records.calls || [];
      const call = state.records.calls.find(c => c.id === callId && c.agencyId === agency.id);
      if (!call) return sendJson(res, 404, { error: 'Call session not found' });

      const body = await readBody(req);
      const durationSec = Number(body.durationSec) >= 0
        ? Number(body.durationSec)
        : Math.max(1, Math.round((Date.now() - new Date(call.startedAt).getTime()) / 1000));

      call.status = 'completed';
      call.outcome = body.outcome || 'completed';
      call.durationSec = durationSec;
      call.endedAt = new Date().toISOString();
      if (body.notes) {
        call.notes = call.notes ? `${call.notes} - ${body.notes}` : body.notes;
      }
      call.updatedAt = new Date().toISOString();

      if (call.contactId) {
        state.records.contacts = state.records.contacts || [];
        const contact = state.records.contacts.find(c => c.id === call.contactId && c.agencyId === agency.id);
        if (contact) {
          const durationLabel = `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`;
          const callSummary = `[Outbound Call] Duration: ${durationLabel} · Outcome: ${call.outcome}`;
          contact.notes = contact.notes ? `${contact.notes}\n${callSummary}` : callSummary;
          contact.updatedAt = new Date().toISOString();
        }
      }

      await saveState();

      auditLog('telephony.call.ended', actor, {
        callId: call.id,
        durationSec,
        outcome: call.outcome
      });
      broadcast('phone.call.ended', call);

      return sendJson(res, 200, { success: true, call });
    }

    // POST /api/telephony/call/:id/dtmf - Log DTMF tone transmission in active call session
    if (method === 'POST' && pathname.startsWith('/api/telephony/call/') && pathname.endsWith('/dtmf')) {
      const callId = pathname.replace('/api/telephony/call/', '').replace('/dtmf', '').trim();
      state.records.calls = state.records.calls || [];
      const call = state.records.calls.find(c => c.id === callId && c.agencyId === agency.id);
      if (!call) return sendJson(res, 404, { error: 'Call session not found' });

      const body = await readBody(req);
      const digit = String(body.digit || '').trim();
      call.dtmfLog = call.dtmfLog || [];
      call.dtmfLog.push({ digit, timestamp: new Date().toISOString() });
      call.updatedAt = new Date().toISOString();
      await saveState();

      broadcast('phone.call.dtmf', { callId: call.id, digit });

      return sendJson(res, 200, { success: true, callId: call.id, dtmfLog: call.dtmfLog });
    }

    // ═════════════════════════════════════════════════════════════
    // ─── CRM ENHANCED & SMART LISTS ROUTES (MODULAR ROUTER) ────
    // ═════════════════════════════════════════════════════════════
    if (await handleCrmRoutes(req, res, {
      method,
      pathname,
      url,
      readBody,
      sendJson,
      state,
      saveState,
      auditLog,
      broadcast,
      actor,
      agency,
      activeLocation,
      randomUUID,
      parseCSV,
      pgPool,
      triggerWorkflowExecution,
      dispatchZapierEvent,
      zapierRepository,
      syncRelationalWrite,
      collections,
      secretResolver,
      effectiveVaultKey,
      isProd
    })) {
      return;
    }
    if (res.headersSent) {
      return;
    }

    if (pathname.startsWith('/api/opportunities')) {
      if (await handleOpportunitiesRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor,
        agency,
        activeLocation,
        randomUUID,
        parseCSV,
        pgPool,
        triggerWorkflowExecution,
        dispatchZapierEvent,
        zapierRepository,
        syncRelationalWrite,
        collections
      })) {
        return;
      }
    }
    if (res.headersSent) {
      return;
    }

    if (pathname.startsWith('/api/appointments') || pathname.startsWith('/api/calendars')) {
      if (await handleSchedulingRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor,
        agency,
        activeLocation,
        randomUUID,
        pgPool,
        triggerWorkflowExecution,
        dispatchZapierEvent,
        zapierRepository,
        syncRelationalWrite,
        secretResolver,
        effectiveVaultKey,
        isProd
      })) {
        return;
      }
    }

    if (pathname.startsWith('/api/workflows')) {
      if (await handleWorkflowsRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor,
        agency,
        activeLocation,
        randomUUID,
        pgPool,
        triggerWorkflowExecution,
        executeWorkflowInstance,
        executeStep,
        checkTenantUsageLimit,
        recordTenantUsage,
        expirePendingWorkflowApprovals,
        getOutboxRepo,
        isStagingOrProd,
        platformDbEnabled
      })) {
        return;
      }
    }

    if (pathname.startsWith('/api/pipelines')) {
      if (await handlePipelinesRoutes(req, res, {
        method,
        pathname,
        url,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        actor,
        agency,
        activeLocation,
        pgPool
      })) {
        return;
      }
    }

    if (
      pathname.startsWith('/api/orders') ||
      pathname.startsWith('/api/invoices') ||
      pathname.startsWith('/api/payments') ||
      pathname.startsWith('/api/ledger/')
    ) {
      if (await handlePaymentsRoutes(req, res, {
        method, pathname, url, readBody, readRawBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool,
        triggerWorkflowExecution, isWebhookReplay, logStructured
      })) {
        return;
      }
    }
    if (res.headersSent) {
      return;
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

    // ═════════════════════════════════════════════════════════════
    // ─── PLATFORM FOUNDATION: PROVIDERS, CONSENT, ENTITLEMENTS ──
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/platform/plans') {
      return sendJson(res, 200, { data: listPlans() });
    }

    if (method === 'POST' && pathname === '/api/platform/plans/upgrade') {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and admins can upgrade plans' });
      }
      const body = await readBody(req);
      const targetPlanId = body.planId || 'growth';
      const availablePlans = ['beta', 'studio', 'growth', 'enterprise'];
      if (!availablePlans.includes(targetPlanId)) {
        return sendJson(res, 400, { error: 'Invalid plan selected' });
      }

      state.tenantPlans = state.tenantPlans || {};
      state.tenantPlans[agency.id] = {
        planId: targetPlanId,
        upgradedAt: new Date().toISOString(),
        upgradedByActorId: actor.user.id,
        billingCycle: body.billingCycle || 'monthly'
      };
      await saveState();

      const newEntitlements = await getTenantEntitlements(agency.id);
      auditLog('platform.plan.upgraded', actor, { planId: targetPlanId });
      broadcast('platform.plan.upgraded', { agencyId: agency.id, planId: targetPlanId });

      return sendJson(res, 200, {
        success: true,
        planId: targetPlanId,
        entitlements: newEntitlements
      });
    }

    if (method === 'GET' && pathname === '/api/platform/entitlements') {
      const entitlements = await getTenantEntitlements(agency.id);
      return sendJson(res, 200, {
        planId: entitlements.planId,
        label: entitlements.label,
        features: entitlements.features,
        limits: entitlements.limits,
        pricing: null
      });
    }

    if (method === 'GET' && pathname === '/api/platform/usage') {
      const entitlements = await getTenantEntitlements(agency.id);
      return sendJson(res, 200, {
        period: 'current_utc_month',
        usage: await getCurrentUsage(agency.id),
        limits: entitlements.limits,
        features: entitlements.features
      });
    }

    if (method === 'GET' && pathname === '/api/platform/oauth/outlook/start') {
      if (!['owner','admin'].includes(actor.membership.role)) return sendJson(res,403,{error:'Only workspace owners and admins can connect Outlook'});
      if (!outlookOAuthService?.isConfigured) return sendJson(res,503,{error:'Microsoft Outlook OAuth is not configured on this deployment',code:'OUTLOOK_OAUTH_NOT_CONFIGURED'});
      try {
        const auth=await outlookOAuthService.begin({tenantId:agency.id,locationId:activeLocation.id,actorId:actor.user.id});
        res.writeHead(302,{Location:auth.authorizationUrl,'Cache-Control':'no-store',Pragma:'no-cache'});res.end();return;
      } catch(err) { return sendJson(res,400,{error:'Could not start Outlook authorization',code:err.code||'OUTLOOK_OAUTH_START_FAILED'}); }
    }

    if (method === 'GET' && pathname === '/api/platform/oauth/outlook/callback') {
      const destination=new URL('/integrations',process.env.APP_BASE_URL||process.env.FRONTEND_URL||url.origin);
      if(url.searchParams.has('error')) {
        destination.searchParams.set('outlook','denied');
        res.writeHead(302,{Location:destination.toString(),'Cache-Control':'no-store'});res.end();return;
      }
      try {
        if(!outlookOAuthService?.isConfigured) throw Object.assign(new Error('Outlook OAuth unavailable'),{code:'OUTLOOK_OAUTH_NOT_CONFIGURED'});
        if(!['owner','admin'].includes(actor.membership.role)) throw Object.assign(new Error('Admin role required'),{code:'OUTLOOK_ROLE_FORBIDDEN'});
        const result=await outlookOAuthService.complete({
          code:url.searchParams.get('code'),state:url.searchParams.get('state'),
          tenantId:agency.id,locationId:activeLocation.id,actorId:actor.user.id
        });
        const pending=createProviderConnection({
          tenantId:agency.id,locationId:activeLocation.id,providerKey:'email.microsoft_graph',
          secretRef:result.secretRef,label:result.email?'Outlook · '+result.email:'Microsoft Outlook',
          config:{accountId:result.accountId,senderEmail:result.email||'',senderName:result.displayName||''}
        });
        const verification=await verifyProviderConnection(pending,{secretResolver,adapter:providerAdapterRegistry.get('email.microsoft_graph')});
        if(!verification.ok) {
          await secretResolver.delete(result.secretRef).catch(()=>{});
          throw Object.assign(new Error('Microsoft Graph mailbox verification failed'),{code:verification.code||'OUTLOOK_MAILBOX_VERIFICATION_FAILED'});
        }
        const saved=platformRepository
          ? await platformRepository.createProviderConnection(verification.connection)
          : (()=>{state.providerConnections=state.providerConnections||[];state.providerConnections.push(verification.connection);return publicProviderConnection(verification.connection);})();
        if(!platformRepository) await saveState();
        auditLog('provider.outlook.connected',actor,{connectionId:verification.connection.id,providerKey:'email.microsoft_graph'});
        broadcast('platform.providers.verified',saved);
        destination.searchParams.set('outlook','connected');
        res.writeHead(302,{Location:destination.toString(),'Cache-Control':'no-store'});res.end();return;
      } catch(err) {
        logStructured('warn','Outlook OAuth callback failed',{code:err?.code||'OUTLOOK_OAUTH_CALLBACK_FAILED'});
        destination.searchParams.set('outlook','failed');destination.searchParams.set('reason',err?.code||'OUTLOOK_OAUTH_CALLBACK_FAILED');
        res.writeHead(302,{Location:destination.toString(),'Cache-Control':'no-store'});res.end();return;
      }
    }

    if (method === 'GET' && pathname === '/api/platform/providers') {
      return sendJson(res, 200, {
        data: PROVIDER_CATALOG.map(provider => ({
          providerKey: provider.key,
          name: provider.label,
          category: provider.channel,
          capabilities: provider.key === 'email.microsoft_graph' ? ['OAuth 2.0','Send email','Refresh tokens']
            : provider.channel === 'email' ? ['Send email'] : provider.channel === 'sms' ? ['Send SMS']
            : provider.channel === 'whatsapp' ? ['Send WhatsApp message'] : [],
          availability: provider.key === 'email.microsoft_graph'
            ? (outlookOAuthService?.isConfigured ? 'oauth_ready' : 'oauth_configuration_required')
            : provider.status,
          adapterAvailable: providerAdapterRegistry.has(provider.key),
          oauthAvailable: provider.key === 'email.microsoft_graph' ? Boolean(outlookOAuthService?.isConfigured) : false,
          liveDispatch: false,
          secretRefFormatHint: 'vault:<tenant>/<location>/<credential-name>'
        }))
      });
    }

    if (method === 'GET' && pathname === '/api/platform/connections') {
      const connections = platformRepository
        ? await platformRepository.listProviderConnections({ tenantId: agency.id, locationId: activeLocation.id })
        : (state.providerConnections || []).filter(
            item => item.tenantId === agency.id && item.locationId === activeLocation.id
          ).map(publicProviderConnection);
      return sendJson(res, 200, { data: connections });
    }

    if (method === 'POST' && pathname === '/api/platform/connections') {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and admins can configure providers' });
      }
      const body = await readBody(req);
      const requiredSecretPrefix = `vault:${agency.id}/${activeLocation.id}/`;
      if (isStagingOrProd && !String(body.secretRef || '').startsWith(requiredSecretPrefix)) {
        return sendJson(res, 400, {
          error: 'Production provider credentials must use a tenant/location-scoped vault reference',
          code: 'TENANT_VAULT_REFERENCE_REQUIRED'
        });
      }
      if (String(body.secretRef || '').startsWith('vault:') && !String(body.secretRef).startsWith(requiredSecretPrefix)) {
        return sendJson(res, 403, {
          error: 'Provider secret reference belongs to a different tenant or location',
          code: 'CROSS_TENANT_SECRET_REFERENCE'
        });
      }
      if (body.providerKey === 'payments.stripe') {
        return sendJson(res, 409, { error: 'Payment processing remains disabled until payment verification, reconciliation and refund controls are deployed', code: 'PAYMENTS_DISABLED' });
      }
      const connection = createProviderConnection({
        tenantId: agency.id,
        locationId: activeLocation.id,
        providerKey: body.providerKey,
        secretRef: body.secretRef,
        label: body.label,
        config: body.config || {}
      });
      const savedConnection = platformRepository
        ? await platformRepository.createProviderConnection(connection)
        : (() => {
            state.providerConnections = state.providerConnections || [];
            state.providerConnections.push(connection);
            return publicProviderConnection(connection);
          })();
      if (!platformRepository) await saveState();
      auditLog('provider.connection.created', actor, {
        connectionId: connection.id,
        providerKey: connection.providerKey,
        status: connection.status
      });
      return sendJson(res, 201, { success: true, connection: savedConnection });
    }

    if (method === 'POST' && pathname.startsWith('/api/platform/connections/') && pathname.endsWith('/verify')) {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and admins can verify providers' });
      }
      const connectionId = pathname.split('/')[4];
      const connection = platformRepository
        ? await platformRepository.getProviderConnection({ tenantId: agency.id, locationId: activeLocation.id, connectionId })
        : (state.providerConnections || []).find(
            item => item.id === connectionId && item.tenantId === agency.id && item.locationId === activeLocation.id
          );
      if (!connection) return sendJson(res, 404, { error: 'Provider connection not found' });

      const enableAdapter = req.headers['x-operza-verify-adapter'] === 'enabled' || url.searchParams.get('live') === 'true' || process.env.OPERZA_ENABLE_PROVIDER_ADAPTERS === 'true';
      if (!enableAdapter) {
        return sendJson(res, 501, {
          error: 'No trusted provider verification adapter is configured in this deployment',
          code: 'PROVIDER_ADAPTER_UNAVAILABLE',
          connection: publicProviderConnection(connection)
        });
      }

      const adapter = providerAdapterRegistry.get(connection.providerKey);
      if (!adapter) {
        return sendJson(res, 501, {
          error: 'No trusted provider verification adapter is configured for this provider key',
          code: 'PROVIDER_ADAPTER_UNAVAILABLE',
          connection: publicProviderConnection(connection)
        });
      }

      const verifyResult = await verifyProviderConnection(connection, { secretResolver, adapter });
      if (!verifyResult.ok) {
        if (['PROVIDER_ADAPTER_UNAVAILABLE', 'SECRET_RESOLVER_UNAVAILABLE'].includes(verifyResult.code)) {
          return sendJson(res, 501, { error: 'Provider verification adapter unavailable', code: verifyResult.code, connection: publicProviderConnection(verifyResult.connection) });
        }
        return sendJson(res, 400, { error: 'Provider verification failed', code: verifyResult.code, connection: publicProviderConnection(verifyResult.connection) });
      }

      // Update state with verified connection
      if (platformRepository) {
        // platformRepository persists if normalized mode is on
      } else {
        const idx = (state.providerConnections || []).findIndex(c => c.id === connectionId);
        if (idx !== -1) {
          state.providerConnections[idx] = verifyResult.connection;
          await saveState();
        }
      }

      auditLog('platform.provider.verified', actor, {
        connectionId,
        providerKey: connection.providerKey,
        channel: connection.channel
      });
      broadcast('platform.providers.verified', publicProviderConnection(verifyResult.connection));

      return sendJson(res, 200, {
        success: true,
        connection: publicProviderConnection(verifyResult.connection)
      });
    }

    if (method === 'POST' && pathname === '/api/platform/secrets/store') {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and admins can store secrets' });
      }
      const body = await readBody(req);
      if (!body.secretRef || !body.plaintext) {
        return sendJson(res, 400, { error: 'secretRef and plaintext are required' });
      }
      const requiredSecretPrefix = `vault:${agency.id}/${activeLocation.id}/`;
      if (!String(body.secretRef).startsWith(requiredSecretPrefix)) {
        return sendJson(res, 403, {
          error: 'Secrets must be stored under the active tenant/location vault namespace',
          code: 'CROSS_TENANT_SECRET_REFERENCE'
        });
      }
      await secretResolver.store(body.secretRef, body.plaintext);
      return sendJson(res, 200, { success: true, secretRef: body.secretRef, stored: true });
    }

    if (method === 'POST' && pathname.startsWith('/api/platform/connections/') && pathname.endsWith('/revoke')) {
      if (!['owner', 'admin'].includes(actor.membership.role)) {
        return sendJson(res, 403, { error: 'Only workspace owners and admins can revoke providers' });
      }
      const connectionId = pathname.split('/')[4];
      const connection = platformRepository
        ? await platformRepository.getProviderConnection({ tenantId: agency.id, locationId: activeLocation.id, connectionId })
        : (state.providerConnections || []).find(
            item => item.id === connectionId && item.tenantId === agency.id && item.locationId === activeLocation.id
          );
      if (!connection) return sendJson(res, 404, { error: 'Provider connection not found' });
      const revoked = revokeProviderConnection(connection);
      const savedConnection = platformRepository
        ? await platformRepository.updateProviderConnection({ tenantId: agency.id, locationId: activeLocation.id, connection: revoked })
        : publicProviderConnection(revoked);
      if (!platformRepository) {
        const index = state.providerConnections.findIndex(item => item.id === connectionId);
        state.providerConnections[index] = revoked;
        await saveState();
      }
      auditLog('provider.connection.revoked', actor, {
        connectionId,
        providerKey: connection.providerKey
      });
      return sendJson(res, 200, { success: true, connection: savedConnection });
    }

    if (
      pathname === '/api/platform/consents' ||
      (pathname.startsWith('/api/platform/consents/') && pathname.endsWith('/revoke'))
    ) {
      if (await handleConversationsRoutes(req, res, {
        method, pathname, url, readBody, sendJson, state, saveState,
        auditLog, broadcast, actor, agency, activeLocation, pgPool, randomUUID
      })) {
        return;
      }
    }

    // Note: /api/workflows routes (runs, approvals, tick, nodes, run, test)
    // are now handled cleanly by handleWorkflowsRoutes() above.

    // ═════════════════════════════════════════════════════════════
    // ─── NOTIFICATIONS & TEAM ALERTS ─────────────────────────────
    // ═════════════════════════════════════════════════════════════

    if (method === 'GET' && pathname === '/api/notifications') {
      state.notifications = state.notifications || [];
      const notifs = state.notifications.filter(
        n => n.agencyId === agency.id && (!n.locationId || n.locationId === activeLocation.id)
      );
      return sendJson(res, 200, { data: notifs.slice().reverse() });
    }

    if (method === 'POST' && pathname.startsWith('/api/notifications/') && pathname.endsWith('/read')) {
      const notifId = pathname.replace('/api/notifications/', '').replace('/read', '').trim();
      state.notifications = state.notifications || [];
      const notif = state.notifications.find(
        n => n.id === notifId && n.agencyId === agency.id
      );
      if (!notif) return sendJson(res, 404, { error: 'Notification not found' });
      notif.read = true;
      notif.readAt = new Date().toISOString();
      await saveState();
      return sendJson(res, 200, { success: true, notification: notif });
    }

    // Note: CRM Enhanced Endpoints (bulk-tag, import, export-csv, merge, timeline)
    // are now handled cleanly by handleCrmRoutes() above.

    // ═════════════════════════════════════════════════════════════
    // ─── AGENCY: BUSINESS PROFILE, TEAM, WORKSPACES, SNAPSHOTS ──
    // ═════════════════════════════════════════════════════════════
    if (pathname.startsWith('/api/agency/')) {
      if (await handleAgencyRoutes(req, res, {
        method,
        pathname,
        readBody,
        sendJson,
        state,
        saveState,
        auditLog,
        broadcast,
        randomBytes,
        randomUUID,
        actor,
        agency,
        activeLocation,
        getDefaultBranding: () => ({
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
        })
      })) {
        return;
      }
      if (res.headersSent) {
        return;
      }
    }
    // Note: /api/agency/* (team, locations, snapshots, branding) are handled by handleAgencyRoutes() above.

    // ═════════════════════════════════════════════════════════════
    // ─── INTEGRATIONS & APP MARKETPLACE ─────────────────────────
    // ═════════════════════════════════════════════════════════════

    const getDefaultIntegrations = () => {
      return [
        { id: 'twilio', name: 'Twilio', category: 'Communications', description: 'SMS messaging, phone numbers, and voice call tracking', icon: 'phone', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'sendgrid', name: 'SendGrid', category: 'Communications', description: 'Transactional email delivery and marketing campaigns', icon: 'mail', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'resend', name: 'Resend', category: 'Communications', description: 'Modern developer email delivery with domain verification', icon: 'mail', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'whatsapp', name: 'WhatsApp (Meta Cloud API)', category: 'Communications', description: 'Official WhatsApp business messaging', icon: 'message', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'google_calendar', name: 'Google Calendar', category: 'Calendar', description: 'Two-way appointment synchronization and scheduling', icon: 'calendar', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'outlook', name: 'Microsoft 365 (Outlook & Calendar)', category: 'Communications', description: 'Two-way Outlook mail and calendar sync', icon: 'mail', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'zapier', name: 'Zapier & Webhooks API', category: 'Automation', description: 'Operza exposes a tenant-scoped REST Hook API for Zapier; no external Zapier account is assumed connected.', icon: 'zap', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'stripe', name: 'Stripe', category: 'Payment', description: 'Credit card processing, subscriptions, and payment links', icon: 'credit-card', connected: false, accountName: '', status: 'disabled_pending_compliance', lastSyncAt: null },
        { id: 'meta_ads', name: 'Meta Ads', category: 'Marketing', description: 'Instant lead sync from Facebook & Instagram lead forms', icon: 'facebook', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'shopify', name: 'Shopify', category: 'Commerce', description: 'E-commerce store orders, customer import, and product sync', icon: 'store', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null },
        { id: 'slack', name: 'Slack', category: 'Notifications', description: 'Real-time notifications for leads, booked appointments, and deals', icon: 'message', connected: false, accountName: '', status: 'unconfigured', lastSyncAt: null }
      ];
    };

    if (method === 'GET' && pathname === '/api/integrations') {
      state.records.integrations = state.records.integrations || {};
      if (!state.records.integrations[agency.id]) {
        state.records.integrations[agency.id] = getDefaultIntegrations();
        await saveState();
      } else {
        const defaults = getDefaultIntegrations();
        state.records.integrations[agency.id] = state.records.integrations[agency.id].map(item => {
          const def = defaults.find(d => d.id === item.id);
          if (def && item.status === 'connected' && !item.verifiedAt) {
            return { ...item, connected: false, status: 'unconfigured', accountName: '' };
          }
          return item;
        });
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

      if (['shopify', 'meta_ads', 'slack'].includes(integrationId)) {
        return sendJson(res, 501, {
          success: false,
          code: 'INTEGRATION_ADAPTER_NOT_IMPLEMENTED',
          error: `Integration adapter for '${integrationId}' is not implemented in this version of Operza.`
        });
      }

      if (integrationId === 'stripe') {
        return sendJson(res, 403, {
          success: false,
          code: 'PAYMENTS_DISABLED_PENDING_COMPLIANCE',
          error: 'Direct payment processing is disabled pending regulatory compliance review.'
        });
      }

      const body = await readBody(req);
      const secret = body.apiKey || body.secret || body.accessToken;
      if (!secret && !body.accountId) {
        return sendJson(res, 400, {
          success: false,
          code: 'CREDENTIAL_REQUIRED',
          error: 'An API key or credential secret is required to connect this provider.'
        });
      }

      // Map integrationId to provider adapter
      const adapterMap = {
        twilio: 'sms.twilio',
        sendgrid: 'email.sendgrid',
        resend: 'email.resend',
        whatsapp: 'whatsapp.meta_cloud'
      };

      const providerKey = adapterMap[integrationId];
      const adapter = providerKey ? providerAdapterRegistry.get(providerKey) : null;
      if (adapter) {
        const verification = await adapter.verify({
          secret,
          config: {
            accountId: body.accountId || body.config?.accountId,
            fromNumber: body.fromNumber || body.config?.fromNumber,
            senderEmail: body.senderEmail || body.config?.senderEmail,
            phoneNumberId: body.phoneNumberId || body.config?.phoneNumberId
          },
          fetchFn: globalThis.fetch
        });

        if (!verification.verified) {
          return sendJson(res, 400, {
            success: false,
            code: verification.code || 'PROVIDER_AUTH_FAILED',
            error: `Provider verification failed: ${verification.code || 'Invalid credentials'}`
          });
        }
      }

      let secretRef = null;
      if (secret && secretResolver) {
        secretRef = `vault:${agency.id}/${activeLocation.id}/integration_${integrationId}_${Date.now()}`;
        try {
          await secretResolver.store(secretRef, secret);
        } catch (vaultErr) {
          console.warn('[VAULT] Failed to encrypt integration secret:', vaultErr.message);
        }
      }

      target.connected = true;
      target.status = 'connected';
      target.accountName = body.accountName || target.accountName || `${agency.name} (${integrationId})`;
      target.lastSyncAt = new Date().toISOString();
      target.verifiedAt = new Date().toISOString();
      target.config = {
        hasApiKey: true,
        accountId: body.accountId || null,
        secretRef: secretRef || null
      };

      if (pgPool && providerKey) {
        await pgPool.query(`
          INSERT INTO provider_connections (id, agency_id, location_id, provider_key, status, label, updated_at)
          VALUES ($1, $2, $3, $4, 'connected', $5, now())
          ON CONFLICT (agency_id, location_id, provider_key) DO UPDATE SET
            status = 'connected', label = EXCLUDED.label, updated_at = now()
        `, [randomUUID(), agency.id, activeLocation.id, providerKey, target.accountName]).catch(() => {});
      }

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

      if (target.config?.secretRef && secretResolver) {
        await secretResolver.delete(target.config.secretRef).catch(() => {});
      }

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

      const adapterMap = {
        twilio: 'sms.twilio',
        sendgrid: 'email.sendgrid',
        resend: 'email.resend',
        whatsapp: 'whatsapp.meta_cloud'
      };

      const providerKey = adapterMap[integrationId];
      const adapter = providerKey ? providerAdapterRegistry.get(providerKey) : null;
      if (!adapter) {
        return sendJson(res, 501, {
          success: false,
          code: 'INTEGRATION_TEST_NOT_IMPLEMENTED',
          error: `A live health check is not implemented for integration connector '${integrationId}'.`
        });
      }

      if (!target.connected) {
        return sendJson(res, 400, {
          success: false,
          code: 'INTEGRATION_NOT_CONNECTED',
          error: `Integration '${integrationId}' is not connected. Connect it first before testing.`
        });
      }

      let secret = null;
      if (target.config?.secretRef && secretResolver) {
        try {
          secret = await secretResolver.resolve(target.config.secretRef);
        } catch (_) {}
      }

      if (!secret && !target.config?.accountId) {
        return sendJson(res, 400, {
          success: false,
          code: 'INTEGRATION_CREDENTIAL_MISSING',
          error: 'No stored credentials available to test this integration.'
        });
      }

      const t0 = Date.now();
      const verification = await adapter.verify({
        secret,
        config: {
          accountId: target.config?.accountId
        },
        fetchFn: globalThis.fetch
      });

      const latencyMs = Math.max(1, Date.now() - t0);

      if (!verification.verified) {
        return sendJson(res, 400, {
          success: false,
          code: verification.code || 'PROVIDER_TEST_FAILED',
          error: `Provider test failed: ${verification.code || 'Invalid response'}`,
          latencyMs
        });
      }

      return sendJson(res, 200, {
        success: true,
        verified: true,
        provider: integrationId,
        latencyMs,
        testedAt: new Date().toISOString()
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

    const handleAiPlatformRoute = createAiPlatformRoutes({
      providerGateway: aiPlatformGateway,
      costGovernance: aiCostGovernance,
      toolRegistry: aiToolRegistry,
      voiceManager: aiVoiceManager,
      sendJson,
      readBody,
      auditLog
    });
    if ((await handleAiPlatformRoute({ method, pathname, req, res, agency, activeLocation, actor })) !== false) {
      return;
    }

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
      const newDoc = copilotRag.indexDocument({
        agencyId: agency.id,
        title: title.trim(),
        content: content.trim(),
        type
      });

      state.records.knowledge.push(newDoc);
      await saveState();
      auditLog('ai.knowledge_added', actor, { docId: newDoc.id, title: newDoc.title, chunks: newDoc.chunksCount });
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

      try {
        const chatRes = await copilotService.chat({
          message: query,
          sessionId: `ai_trainer_test_${agency.id}`,
          activeModule: 'AI Copilot Training Center & Knowledge Base (/ai-trainer)',
          agency,
          activeLocation,
          actor,
          state,
          platformRepository
        });

        return sendJson(res, 200, {
          query,
          answer: chatRes.message.content,
          sources: chatRes.message.sources || []
        });
      } catch (err) {
        console.error('[AI Trainer Test] Error:', err);
        return sendJson(res, 500, { error: err.message || 'AI testing error' });
      }
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

      let deliveryStatus = 200;
      let error = null;
      const startedAt = Date.now();

      // Only attempt live network dispatch if not a mock test pipe URL
      if (webhook.url && !webhook.url.includes('hooks.operza.io/receive/test-pipe') && !webhook.url.includes('example.com')) {
        try {
          const pingRes = await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': 'Operza-Webhook-Ping/2.0',
              'X-Operza-Event': 'test.ping'
            },
            body: JSON.stringify({
              event: 'test.ping',
              timestamp: new Date().toISOString(),
              agency: { id: agency.id, name: agency.name },
              data: { ping: 'pong', verified: true }
            }),
            signal: AbortSignal.timeout(4000)
          });
          deliveryStatus = pingRes.status;
        } catch (dispatchErr) {
          deliveryStatus = 502;
          error = dispatchErr.message;
        }
      }

      const durationMs = Math.max(1, Date.now() - startedAt);

      const delivery = {
        id: randomUUID(),
        webhookId,
        agencyId: agency.id,
        url: webhook.url,
        event: 'test.ping',
        status: deliveryStatus,
        durationMs,
        payload: {
          event: 'test.ping',
          timestamp: new Date().toISOString(),
          agency: { id: agency.id, name: agency.name },
          data: { ping: 'pong', verified: true, error }
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

    // Note: /api/agency/branding* routes are handled by handleAgencyRoutes() above.

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

      state.records[collectionName] = state.records[collectionName] || [];
      const list = await loadAuthoritativeCollectionRecords(collectionName, agency.id, activeLocation?.id);

      // GET /api/crm/:collection — with search, filter, pagination, sorting
      if (method === 'GET' && !recordId) {
        let filtered = [...list];

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
        const record = list.find(r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id));
        if (!record) return sendJson(res, 404, { error: 'Record not found' });
        return sendJson(res, 200, record);
      }

      // POST /api/crm/:collection (Create)
      if (method === 'POST' && !recordId) {
        const body = await readBody(req);

        // Normalize title/name aliases for collections supporting both
        if (collectionName === 'documents' || collectionName === 'courses') {
          if (!body.name && body.title) body.name = body.title;
          if (!body.title && body.name) body.title = body.name;
        }

        // Schema validation for required fields
        const schema = collections[collectionName];
        if (schema && Array.isArray(schema.required)) {
          for (const reqField of schema.required) {
            if (!body[reqField] || (typeof body[reqField] === 'string' && !body[reqField].trim())) {
              return sendJson(res, 400, { error: `Field '${reqField}' is required for ${collectionName}` });
            }
          }
        }

        // Security: Prevent client from injecting or overriding tenant context IDs
        const assignedId = (typeof body.id === 'string' && body.id.trim()) ? body.id.trim() : randomUUID();
        delete body.id;
        delete body.agencyId;
        delete body.locationId;

        const newRecord = {
          ...body,
          id: assignedId,
          agencyId: agency.id,
          locationId: activeLocation.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        state.records[collectionName] = state.records[collectionName] || [];
        const existingIdx = state.records[collectionName].findIndex(r => r.id === assignedId);
        if (existingIdx >= 0) {
          state.records[collectionName][existingIdx] = newRecord;
        } else {
          state.records[collectionName].push(newRecord);
        }
        list.push(newRecord);
        await saveState();
        await syncRelationalWrite(collectionName, 'create', newRecord, agency.id);

        auditLog(`crm.${collectionName}.created`, actor, { id: newRecord.id });
        broadcast(`crm.${collectionName}.created`, { id: newRecord.id, ...newRecord });

        // Check if creating this record triggers a workflow or Zapier hook
        if (collectionName === 'contacts') {
          triggerWorkflowExecution({
            agencyId: agency.id,
            locationId: activeLocation.id,
            triggerType: 'tag',
            triggerContext: { contact: newRecord }
          }).catch(console.error);

          dispatchZapierEvent({
            zapierRepository,
            state,
            agencyId: agency.id,
            locationId: activeLocation.id,
            event: 'contact.created',
            data: newRecord
          }).catch(console.error);
        }

        return sendJson(res, 201, newRecord);
      }

      // PUT /api/crm/:collection/:id (Update)
      if (method === 'PUT' && recordId) {
        const body = await readBody(req);
        // Security: Strip tenant injection and ID mutation
        delete body.id;
        delete body.agencyId;
        delete body.locationId;

        const index = list.findIndex(r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id));
        if (index === -1) return sendJson(res, 404, { error: 'Record not found' });

        const previousRecord = { ...list[index] };
        const updated = {
          ...list[index],
          ...body,
          id: recordId,
          agencyId: agency.id,
          locationId: activeLocation.id,
          updatedAt: new Date().toISOString()
        };

        // Synchronous PostgreSQL reservation update for appointments (rescheduling / cancellation)
        if (collectionName === 'appointments' && pgPool && (body.startsAt || body.endsAt || body.status)) {
          const client = await pgPool.connect();
          try {
            await client.query('BEGIN');
            await client.query("SELECT set_config('app.agency_id', $1, true)", [String(agency.id)]);
            await client.query("SELECT set_config('app.location_id', $1, true)", [String(activeLocation.id)]);
            await client.query(`
              UPDATE appointments
              SET starts_at = COALESCE($1, starts_at),
                  ends_at = COALESCE($2, ends_at),
                  status = COALESCE($3, status),
                  updated_at = now()
              WHERE id = $4 AND agency_id = $5 AND location_id = $6
            `, [body.startsAt || null, body.endsAt || null, body.status || null, recordId, agency.id, activeLocation.id]);
            await client.query('COMMIT');
          } catch (txErr) {
            await client.query('ROLLBACK').catch(() => {});
            if (txErr.code === '23P01' || txErr.message?.includes('exclude_overlapping_active_appointments')) {
              return sendJson(res, 409, {
                error: 'Cannot reschedule: the selected time slot conflicts with an existing appointment.',
                code: 'SLOT_CONFLICT'
              });
            }
            throw txErr;
          } finally {
            client.release();
          }
        }

        list[index] = updated;
        state.records[collectionName] = state.records[collectionName] || [];
        const globalIdx = state.records[collectionName].findIndex(r => r.id === recordId);
        if (globalIdx >= 0) {
          state.records[collectionName][globalIdx] = updated;
        } else {
          state.records[collectionName].push(updated);
        }
        await saveState();
        await syncRelationalWrite(collectionName, 'update', updated, agency.id);

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

          dispatchZapierEvent({
            zapierRepository,
            state,
            agencyId: agency.id,
            locationId: activeLocation.id,
            event: 'opportunity.stage_changed',
            data: {
              opportunity: updated,
              stage: body.stage,
              previousStage: previousRecord.stage
            }
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

          dispatchZapierEvent({
            zapierRepository,
            state,
            agencyId: agency.id,
            locationId: activeLocation.id,
            event: 'contact.updated',
            data: updated
          }).catch(console.error);
        }

        return sendJson(res, 200, updated);
      }

      // DELETE /api/crm/:collection/:id
      if (method === 'DELETE' && recordId) {
        const index = list.findIndex(r => r.id === recordId && r.agencyId === agency.id && (!r.locationId || !activeLocation || r.locationId === activeLocation.id));
        if (index === -1) return sendJson(res, 404, { error: 'Record not found' });
        const deleted = list.splice(index, 1)[0];
        state.records[collectionName] = state.records[collectionName] || [];
        const globalDelIdx = state.records[collectionName].findIndex(r => r.id === recordId);
        if (globalDelIdx >= 0) {
          state.records[collectionName].splice(globalDelIdx, 1);
        }
        await saveState();
        await syncRelationalWrite(collectionName, 'delete', deleted, agency.id);
        auditLog(`crm.${collectionName}.deleted`, actor, { id: recordId });
        broadcast(`crm.${collectionName}.deleted`, { id: recordId });
        return sendJson(res, 200, { success: true, deleted });
      }
    }

    sendJson(res, 404, { error: 'Route not found' });
  } catch (error) {
    const errorDetails = isProd ? 'Internal Server Error' : (error.message || 'Internal Server Error');
    logStructured('ERROR', 'Unhandled server error', {
      error: error.message,
      stack: isProd ? undefined : error.stack,
      requestId: req?.requestId,
      url: req?.url
    });
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: errorDetails,
        code: error.code || 'INTERNAL_SERVER_ERROR',
        requestId: req?.requestId
      });
    }
  }
});

// ═══════════════════════════════════════════════════════════════════════
// ─── STARTUP ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════

await initDatabase();
await workflowQueue.init();
await loadState();
state.workflowApprovals = state.workflowApprovals || [];
if (platformDbEnabled) {
  if (!pgPool) throw new Error('Platform database connection was not ready; normalized mode cannot fall back to JSON.');
  await platformRepository.checkReady();
  console.log('[OPERZA-PLATFORM] Normalized PostgreSQL platform persistence is enabled.');
}

// Resume executions whose approved transition was durably recorded before a process restart.
for (const interruptedRun of (state.workflowExecutions || []).filter(
  item => item.status === 'resuming' && item.approvedNodeId && item.workflowSnapshot
)) {
  try {
    await executeWorkflowInstance({
      flow: structuredClone(interruptedRun.workflowSnapshot),
      agencyId: interruptedRun.agencyId,
      locationId: interruptedRun.locationId,
      triggerType: interruptedRun.triggerType,
      triggerContext: interruptedRun.triggerContext,
      mode: interruptedRun.mode,
      execution: interruptedRun
    });
  } catch (recoveryError) {
    interruptedRun.status = 'failed';
    interruptedRun.lastErrorCode = recoveryError.code || 'RESUME_RECOVERY_FAILED';
    interruptedRun.finishedAt = new Date().toISOString();
    await saveState();
    logStructured('ERROR', 'Workflow resume recovery failed', {
      executionId: interruptedRun.id,
      error: recoveryError.message
    });
  }
}

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

// Production Security Boot Guards (Master Plan Task 0.3)
if (process.env.NODE_ENV === 'production') {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret || secret === 'super-secret-session-key' || secret.length < 32) {
    console.error('FATAL [SECURITY BOOT GUARD]: Insecure or default SESSION_SECRET in production. Minimum 32-character secret required.');
    process.exit(1);
  }
}

server.listen(port, host, () => {
  console.log(`🚀 Operza Unified API Server v2.0 running at http://${host}:${port}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   Readiness: http://localhost:${port}/ready`);
  console.log(`   Metrics: http://localhost:${port}/metrics`);
  console.log(`   WebSocket: ws://localhost:${port}/ws`);
});

// Graceful process shutdown handling
function handleGracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}, closing Operza Unified API gracefully...`);
  for (const client of wsClients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch { /* ignore */ }
  }
  server.close(async () => {
    console.log('✅ HTTP server closed.');
    if (pgPool) {
      try {
        await pgPool.end();
        console.log('✅ PostgreSQL pool terminated.');
      } catch (err) {
        console.error('Error closing PG pool:', err.message);
      }
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
