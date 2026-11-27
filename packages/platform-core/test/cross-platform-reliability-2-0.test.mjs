import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

import {
  CANONICAL_ENTITY_OWNERSHIP,
  CANONICAL_EVENT_CONTRACTS,
  aggregateCanonicalRevenueByCurrency,
  createCrossModuleEventEnvelope,
  evaluateIntegrationHealth,
  publishCrossModuleEvent
} from '../src/cross-platform-events.mjs';
import { evaluateRecipientEligibility } from '../src/engagement-2-0.mjs';
import {
  assertCustomerOwnsRecord,
  generatePortalToken,
  hashPortalToken,
  verifyMagicLinkRecord
} from '../src/customer-portal-2-0.mjs';
import { validatePageSchema } from '../src/sites-2-0.mjs';
import { buildAiSupportSuggestion } from '../src/unified-inbox-2-0.mjs';
import { evaluateRetryEligibility } from '../../workflow-engine/src/operations-2-0.mjs';
import { createMemoryOutboxRepository } from '../src/outbox-worker.mjs';
import { IsolatedTestPostgres } from '../../db/lib/test-postgres-server.mjs';
import { runInTenantTx } from '../../db/lib/tenant-tx.mjs';
import { createUnifiedInboxRepository } from '../../db/lib/unified-inbox-repository.mjs';
import { createWorkflowOperationsRepository } from '../../db/lib/workflow-operations-repository.mjs';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '../../..');
const migrationsDir = path.join(root, 'packages/db/migrations');

test('Cross-Platform 2.0: Canonical Entities, Versioned Events, Outbox Deduplication, Health & Revenue Aggregation', async () => {
  assert.ok(CANONICAL_ENTITY_OWNERSHIP.contact);
  assert.ok(CANONICAL_EVENT_CONTRACTS['commerce.payment.recorded']);

  // Loop guard & secret redaction
  const repo = createMemoryOutboxRepository();
  const res1 = await publishCrossModuleEvent({
    repository: repo,
    eventType: 'crm.opportunity.won',
    agencyId: 'ag1',
    locationId: 'loc1',
    entityId: 'opp1',
    payload: { valueCents: 25000, apiKey: 'sk_live_secret' }
  });
  assert.equal(res1.enqueued, true);
  assert.equal(res1.envelope.payload.apiKey, '[REDACTED]');

  // Duplicate event idempotency
  const res2 = await publishCrossModuleEvent({
    repository: repo,
    eventType: 'crm.opportunity.won',
    agencyId: 'ag1',
    locationId: 'loc1',
    entityId: 'opp1',
    payload: { valueCents: 25000 }
  });
  assert.equal(res2.envelope.idempotencyKey, res1.envelope.idempotencyKey);
  assert.equal(res2.outboxRecord.deduplicated, true);
  assert.equal(res2.outboxRecord.id, res1.outboxRecord.id);

  assert.throws(
    () => createCrossModuleEventEnvelope({ eventType: 'crm.contact.created', agencyId: 'ag1', locationId: 'loc1', entityId: 'c1', loopDepth: 4 }),
    { code: 'WORKFLOW_LOOP_PREVENTED' }
  );

  // Integration health honesty
  const health = evaluateIntegrationHealth({
    connections: [
      { id: '1', connectorId: 'twilio', provider: 'twilio', status: 'active', hasSecretRef: true, readinessLevel: 'test_adapter' },
      { id: '2', connectorId: 'resend', provider: 'resend', status: 'pending', hasSecretRef: false }
    ],
    liveProvidersEnabled: false
  });
  assert.equal(health.connections[0].healthState, 'test_adapter_only');
  assert.equal(health.connections[1].healthState, 'authorization_required');

  // Currency-aware revenue excluding unpaid invoices & subtracting completed refunds
  const rev = aggregateCanonicalRevenueByCurrency({
    invoices: [
      { status: 'paid', currency: 'USD', totalCents: 10000 },
      { status: 'draft', currency: 'USD', totalCents: 50000 },
      { status: 'paid', currency: 'EUR', totalCents: 8000 }
    ],
    refunds: [
      { status: 'completed', currency: 'USD', amountCents: 2500 },
      { status: 'pending', currency: 'EUR', amountCents: 1000 }
    ]
  });
  assert.deepEqual(rev, [
    { currency: 'USD', grossCents: 10000, refundedCents: 2500, netCents: 7500, paidInvoices: 1 },
    { currency: 'EUR', grossCents: 8000, refundedCents: 0, netCents: 8000, paidInvoices: 1 }
  ]);
});

test('Cross-Platform 2.0: End-to-End Journeys A-H & PostgreSQL FORCE RLS Isolation', async (t) => {
  let pgServer = null;
  let adminPool = null;
  let appPool = null;
  let dbUrl = process.env.OPERZA_TEST_DATABASE_URL;

  if (!dbUrl) {
    try {
      pgServer = new IsolatedTestPostgres({ port: 0, dbName: 'operza_xplatform_2_test' });
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
    const wfA = randomUUID();
    const execA = randomUUID();

    await adminPool.query(`INSERT INTO agencies (id, name, slug) VALUES ($1, 'XP A', $2), ($3, 'XP B', $4)`, [
      agencyA, `xp-a-${agencyA.slice(0, 6)}`, agencyB, `xp-b-${agencyB.slice(0, 6)}`
    ]);
    await adminPool.query(`INSERT INTO locations (id, agency_id, name) VALUES ($1, $2, 'Loc A'), ($3, $4, 'Loc B')`, [
      locA, agencyA, locB, agencyB
    ]);

    // Journey A: Lead -> Opportunity -> Invoice -> Contact
    await adminPool.query(
      `INSERT INTO location_records (id, agency_id, location_id, collection, body)
       VALUES ($1, $2, $3, 'contacts', $4::jsonb),
              ($5, $2, $3, 'opportunities', $6::jsonb),
              ($7, $2, $3, 'invoices', $8::jsonb)`,
      [
        contactA, agencyA, locA,
        JSON.stringify({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com', status: 'customer' }),
        randomUUID(), JSON.stringify({ contactId: contactA, title: 'Enterprise Deal', valueCents: 120000, status: 'won' }),
        randomUUID(), JSON.stringify({ contactId: contactA, invoiceNumber: 'INV-1001', totalCents: 120000, status: 'paid' })
      ]
    );

    // Journey B: Support Conversation
    await adminPool.query(
      `INSERT INTO conversations (id, agency_id, location_id, contact_id, contact_name, channel, status, priority, subject)
       VALUES ($1, $2, $3, $4, 'Grace Hopper', 'webchat', 'open', 'high', 'Onboarding help')`,
      [convA, agencyA, locA, contactA]
    );

    // Journey D: Workflow Execution
    await adminPool.query(
      `INSERT INTO workflow_definitions (id, agency_id, location_id, name, status, trigger_type, nodes, version)
       VALUES ($1, $2, $3, 'Onboarding Flow', 'published', 'form', '[]'::jsonb, 2)`,
      [wfA, agencyA, locA]
    );
    await adminPool.query(
      `INSERT INTO workflow_executions (id, agency_id, location_id, workflow_id, workflow_name, workflow_version, status, last_error_code, failure_category, retryable)
       VALUES ($1, $2, $3, $4, 'Onboarding Flow', 2, 'failed', 'ETIMEDOUT', 'transient_network', true)`,
      [execA, agencyA, locA, wfA]
    );

    const inboxRepo = createUnifiedInboxRepository();
    const wfOpsRepo = createWorkflowOperationsRepository();
    const ctxA = { agencyId: agencyA, locationId: locA, actorId: 'op_a' };
    const ctxB = { agencyId: agencyB, locationId: locB, actorId: 'op_b' };

    // Verify Tenant B cannot access Tenant A's Customer 360, Support Inbox, or Workflow Executions under FORCE RLS
    const c360B = await runInTenantTx(appPool, ctxB, tx => inboxRepo.getCustomer360Context(tx, { contactId: contactA, includeFinancials: true }));
    assert.equal(c360B, null);
    const wfB = await runInTenantTx(appPool, ctxB, tx => wfOpsRepo.getOperationalRunDetail(tx, execA));
    assert.equal(wfB, null);

    // Journey B + E: Customer 360 reflects CRM + Opportunities + Paid Invoice + Tickets with financial gating
    await runInTenantTx(appPool, ctxA, tx => inboxRepo.createTicket(tx, { conversationId: convA, contactId: contactA, subject: 'Setup SSO' }, 'op_a'));
    const c360Restricted = await runInTenantTx(appPool, ctxA, tx => inboxRepo.getCustomer360Context(tx, { contactId: contactA, includeFinancials: false }));
    assert.equal(c360Restricted.opportunities.length, 1);
    assert.equal(c360Restricted.tickets.length, 1);
    assert.equal(c360Restricted.financials.authorized, false);
    assert.equal(c360Restricted.financials.invoices.length, 0);

    const c360Authorized = await runInTenantTx(appPool, ctxA, tx => inboxRepo.getCustomer360Context(tx, { contactId: contactA, includeFinancials: true }));
    assert.equal(c360Authorized.financials.authorized, true);
    assert.equal(c360Authorized.financials.invoices.length, 1);

    // Journey C: Marketing suppression check
    const elig = evaluateRecipientEligibility({
      contact: { id: contactA, email: 'grace@example.com', emailSubscribed: false },
      channel: 'email',
      purpose: 'marketing'
    });
    assert.equal(elig.eligible, false);

    // Journey D: Workflow retry eligibility preserves v2
    const retryCheck = evaluateRetryEligibility({
      execution: { id: execA, status: 'failed', failureCategory: 'transient_network', workflowVersion: 2 },
      steps: []
    });
    assert.equal(retryCheck.eligible, true);
    assert.equal(retryCheck.preservedWorkflowVersion, 2);

    // Journey F: Portal magic link & IDOR protection
    const { rawToken, tokenHash } = generatePortalToken();
    assert.equal(hashPortalToken(rawToken).length, 64);
    assert.equal(verifyMagicLinkRecord({ agency_id: agencyA, expires_at: new Date(Date.now() + 60_000).toISOString() }, { expectedAgencyId: agencyB }).code, 'MAGIC_LINK_AGENCY_MISMATCH');
    assert.throws(() => assertCustomerOwnsRecord({ agency_id: agencyA, location_id: locA, contact_id: contactA }, { agencyId: agencyA, locationId: locA, contactId: 'other_cust' }), { code: 'CUSTOMER_OWNERSHIP_DENIED' });

    // Journey G: Sites schema validation
    const pageCheck = validatePageSchema({
      title: 'Lead Capture',
      slug: '/lead-capture',
      sections: [{ id: 'b1', type: 'hero', props: { heading: 'Welcome' } }]
    });
    assert.equal(pageCheck.valid, true);

    // Journey H: AI Support Governance (honest unavailable + redaction + human approval)
    const aiRes = await buildAiSupportSuggestion({
      messages: [{ direction: 'inbound', senderType: 'contact', body: 'Need help', createdAt: new Date().toISOString() }],
      contact: { firstName: 'Grace', secret: 'top_secret' },
      aiConfig: { enabled: false, hasCredentials: false }
    });
    assert.equal(aiRes.aiAvailable, false);
    assert.equal(aiRes.requiresHumanApproval, true);
    assert.equal(aiRes.autoSend, false);
  } finally {
    if (appPool) await appPool.end().catch(() => {});
    if (adminPool) await adminPool.end().catch(() => {});
    if (pgServer) await pgServer.stop().catch(() => {});
  }
});
