import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  CHANNEL_CONNECTION_STATES,
  assertValidSupportTransition,
  buildAiSupportSuggestion,
  buildSupportWorkflowEvent,
  computeSlaDeadlines,
  evaluateSlaStatus,
  renderSafeSavedReply,
  resolveChannelConnectionStatus,
  validateSavedReplyTemplate
} from '../src/unified-inbox-2-0.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';
import { runInTenantTx } from '../../db/lib/tenant-tx.mjs';
import { createUnifiedInboxRepository } from '../../db/lib/unified-inbox-repository.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Unified Inbox 2.0: lifecycle transitions, channel honesty, SLA business hours, saved replies, AI & workflow events', async () => {
  // 1. Transitions & reopen
  assertValidSupportTransition('conversation', 'open', 'waiting_on_customer');
  assertValidSupportTransition('conversation', 'resolved', 'open');
  assert.throws(() => assertValidSupportTransition('ticket', 'closed', 'waiting_on_internal'), { code: 'INVALID_STATUS_TRANSITION' });

  // 2. Channel connection status honesty
  assert.equal(resolveChannelConnectionStatus({ channel: 'webchat', sendingEnabled: true }).status, CHANNEL_CONNECTION_STATES.CONNECTED);
  assert.equal(resolveChannelConnectionStatus({ channel: 'email', connections: [] }).status, CHANNEL_CONNECTION_STATES.NOT_CONFIGURED);
  assert.equal(resolveChannelConnectionStatus({ channel: 'sms', connections: [{ providerKey: 'twilio', status: 'pending_approval' }] }).status, CHANNEL_CONNECTION_STATES.PENDING_APPROVAL);
  assert.equal(resolveChannelConnectionStatus({ channel: 'whatsapp', connections: [{ providerKey: 'whatsapp', status: 'connected' }], sendingEnabled: false }).status, CHANNEL_CONNECTION_STATES.SENDING_DISABLED);

  // 3. SLA business-hours calculation & evaluation
  const policy = {
    id: 'sla1',
    timezone: 'America/New_York',
    businessHours: { enabled: true, startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
    targetsByPriority: { urgent: { firstResponseMin: 15, nextResponseMin: 30, resolutionMin: 120 } },
    pauseStatuses: ['waiting_on_customer'],
    escalationMinutesBefore: 30
  };
  const deadlines = computeSlaDeadlines({ createdAt: '2026-11-27T15:00:00Z', priority: 'urgent', policy });
  assert.ok(deadlines.firstResponseDueAt);
  assert.equal(evaluateSlaStatus({ conversation: { status: 'waiting_on_customer', slaPolicyId: 'sla1', slaResolutionDueAt: deadlines.resolutionDueAt }, policy }).status, 'paused');
  assert.equal(evaluateSlaStatus({ conversation: { status: 'open', slaPolicyId: 'sla1', slaFirstResponseDueAt: '2020-01-01T00:00:00Z' }, policy }).status, 'breached');

  // 4. Saved reply variable validation & escaping
  assert.equal(validateSavedReplyTemplate('Hi {{customer.firstName}}, welcome to {{agency.name}}!').valid, true);
  assert.equal(validateSavedReplyTemplate('Hi {{process.env.SECRET}}').code, 'DISALLOWED_TEMPLATE_VARIABLE');
  assert.equal(validateSavedReplyTemplate('<script>alert(1)</script>').code, 'UNSAFE_HTML');
  const rendered = renderSafeSavedReply('Hello {{customer.firstName}}', { customer: { firstName: '<Ada>' } });
  assert.equal(rendered, 'Hello &lt;Ada&gt;');

  // 5. AI support governance & redaction
  const aiRes = await buildAiSupportSuggestion({
    messages: [{ direction: 'inbound', senderType: 'contact', body: 'Help with my account', createdAt: '2026-11-27T10:00:00Z' }],
    contact: { firstName: 'Ada', apiKey: 'sk_live_secret' },
    aiConfig: { enabled: false, hasCredentials: false }
  });
  assert.equal(aiRes.aiAvailable, false);
  assert.equal(aiRes.autoSend, false);
  assert.equal(aiRes.requiresHumanApproval, true);
  assert.equal(aiRes.redactedContextPreview.contact?.apiKey, undefined);

  // 6. Workflow event builder & loop prevention
  const ev = buildSupportWorkflowEvent({ agencyId: 'a1', locationId: 'l1', eventType: 'conversation.assigned', entityId: 'c1', payload: { token: 'secret' } });
  assert.ok(ev.idempotencyKey.startsWith('sup_'));
  assert.equal(ev.payload.token, '[REDACTED]');
  assert.throws(() => buildSupportWorkflowEvent({ agencyId: 'a1', locationId: 'l1', eventType: 'conversation.assigned', entityId: 'c1', loopDepth: 4 }), { code: 'WORKFLOW_LOOP_PREVENTED' });
});

test('Unified Inbox 2.0: PostgreSQL Migration 051, FORCE RLS, Assignment Concurrency, Note Privacy, Deduplication, Tickets & Customer 360', async (t) => {
  let pgServer = null;
  let adminPool = null;
  let appPool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_unified_inbox_2_test' });
      dbUrl = await pgServer.start();
    } catch (err) {
      t.skip(`PostgreSQL isolated server unavailable: ${err.message}`);
      return;
    }
  }

  try {
    adminPool = new Pool({ connectionString: dbUrl });
    const files = (await readdir(migrationsDir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = await readFile(path.join(migrationsDir, file), 'utf8');
      await adminPool.query(sql);
    }

    await adminPool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'operza_app') THEN
          CREATE ROLE operza_app LOGIN PASSWORD 'operza_app_test_pw';
        END IF;
      END $$;
    `);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO operza_app`);
    await adminPool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO operza_app`);

    const parsed = new URL(dbUrl);
    parsed.username = 'operza_app';
    parsed.password = 'operza_app_test_pw';
    appPool = new Pool({ connectionString: parsed.toString() });

    const agencyA = randomUUID();
    const locA = randomUUID();
    const agencyB = randomUUID();
    const locB = randomUUID();
    const contactA = randomUUID();
    const convA = randomUUID();

    await adminPool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'Inbox A', $2), ($3, 'Inbox B', $4)`, [
      agencyA, `inb-a-${agencyA.slice(0, 6)}`, agencyB, `inb-b-${agencyB.slice(0, 6)}`
    ]);
    await adminPool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Loc A'), ($3, $4, 'Loc B')`, [
      locA, agencyA, locB, agencyB
    ]);
    await adminPool.query(
      `INSERT INTO location_records (id, agency_id, location_id, collection, body)
       VALUES ($1, $2, $3, 'contacts', $4::jsonb)`,
      [contactA, agencyA, locA, JSON.stringify({ firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', status: 'customer' })]
    );
    await adminPool.query(
      `INSERT INTO conversations (id, agency_id, location_id, contact_id, contact_name, channel, status, priority, subject)
       VALUES ($1, $2, $3, $4, 'Ada Lovelace', 'webchat', 'open', 'high', 'Billing question')`,
      [convA, agencyA, locA, contactA]
    );

    const repo = createUnifiedInboxRepository();
    const ctxA = { agencyId: agencyA, locationId: locA, actorId: 'agent_1' };
    const ctxB = { agencyId: agencyB, locationId: locB, actorId: 'agent_2' };

    // 1. Tenant B cannot see Tenant A's conversation under FORCE RLS
    const listB = await runInTenantTx(appPool, ctxB, tx => repo.listInboxConversations(tx, {}));
    assert.equal(listB.total, 0);
    const detailB = await runInTenantTx(appPool, ctxB, tx => repo.getInboxConversationDetail(tx, { conversationId: convA }));
    assert.equal(detailB, null);

    // 2. Assignment + optimistic concurrency check
    const assigned = await runInTenantTx(appPool, ctxA, tx =>
      repo.assignConversation(tx, { conversationId: convA, assignedTo: 'agent_1', assignedAgentName: 'Agent One', expectedVersion: 1, actorId: 'agent_1' })
    );
    assert.equal(assigned.success, true);
    assert.equal(assigned.conversation.version, 2);

    const staleAssign = await runInTenantTx(appPool, ctxA, tx =>
      repo.assignConversation(tx, { conversationId: convA, assignedTo: 'agent_2', expectedVersion: 1, actorId: 'agent_2' })
    );
    assert.equal(staleAssign.conflict, true);
    assert.equal(staleAssign.code, 'ASSIGNMENT_VERSION_CONFLICT');

    // 3. Internal note privacy (excluded when includeInternalNotes: false)
    await runInTenantTx(appPool, ctxA, tx =>
      repo.addInternalNote(tx, { conversationId: convA, authorId: 'agent_1', authorName: 'Agent One', body: 'VIP customer - escalate fast' })
    );
    const portalSafe = await runInTenantTx(appPool, ctxA, tx =>
      repo.getInboxConversationDetail(tx, { conversationId: convA, includeInternalNotes: false })
    );
    assert.equal(portalSafe.internalNotes.length, 0);
    const staffView = await runInTenantTx(appPool, ctxA, tx =>
      repo.getInboxConversationDetail(tx, { conversationId: convA, includeInternalNotes: true })
    );
    assert.equal(staffView.internalNotes.length, 1);

    // 4. Inbound message deduplication by providerMessageId
    const in1 = await runInTenantTx(appPool, ctxA, tx =>
      repo.ingestInboundMessage(tx, { conversationId: convA, contactId: contactA, channel: 'webchat', body: 'Hello!', provider: 'operza_webchat', providerMessageId: 'evt_123' })
    );
    assert.equal(in1.deduplicated, false);
    const in2 = await runInTenantTx(appPool, ctxA, tx =>
      repo.ingestInboundMessage(tx, { conversationId: convA, contactId: contactA, channel: 'webchat', body: 'Hello!', provider: 'operza_webchat', providerMessageId: 'evt_123' })
    );
    assert.equal(in2.deduplicated, true);

    // 5. Support ticket lifecycle + reopen
    const ticket = await runInTenantTx(appPool, ctxA, tx =>
      repo.createTicket(tx, { conversationId: convA, contactId: contactA, subject: 'Invoice discrepancy', priority: 'high' }, 'agent_1')
    );
    assert.equal(ticket.status, 'open');
    await runInTenantTx(appPool, ctxA, tx => repo.updateTicket(tx, { ticketId: ticket.id, status: 'resolved', resolutionSummary: 'Adjusted' }));
    const reopened = await runInTenantTx(appPool, ctxA, tx => repo.updateTicket(tx, { ticketId: ticket.id, status: 'open' }));
    assert.equal(reopened.reopened, true);
    assert.equal(reopened.ticket.reopenedCount, 1);

    // 6. Customer 360 permission gating
    const c360NoFin = await runInTenantTx(appPool, ctxA, tx => repo.getCustomer360Context(tx, { contactId: contactA, includeFinancials: false }));
    assert.equal(c360NoFin.financials.authorized, false);
    const c360WithFin = await runInTenantTx(appPool, ctxA, tx => repo.getCustomer360Context(tx, { contactId: contactA, includeFinancials: true }));
    assert.equal(c360WithFin.financials.authorized, true);

    // 7. Support dashboard metrics
    const metrics = await runInTenantTx(appPool, ctxA, tx => repo.getSupportDashboardMetrics(tx));
    assert.equal(metrics.totalConversations, 1);
    assert.equal(metrics.openCount, 1);
  } finally {
    if (appPool) await appPool.end().catch(() => {});
    if (adminPool) await adminPool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  }
});
