import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBillingLedgerStore,
  createImmutableAuditStore,
  gateAiToolExecution
} from '../src/billing-ledger.mjs';

test('createBillingLedgerStore: balances credits and debits and validates checksum chain', () => {
  const ledger = createBillingLedgerStore();
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  // 1. Initial balance should be 0
  assert.equal(ledger.getBalance({ agencyId, locationId }), 0);

  // 2. Credit top-up of 5000 cents ($50.00)
  const topup = ledger.recordTransaction({
    agencyId,
    locationId,
    entryType: 'credit',
    amountCents: 5000,
    referenceType: 'stripe_topup',
    referenceId: 'ch_stripe_12345',
    description: 'Growth Retainer Token Top-up'
  });

  assert.equal(topup.ok, true);
  assert.equal(topup.account.balanceCents, 5000);
  assert.equal(ledger.getBalance({ agencyId, locationId }), 5000);

  // 3. Debit for Copilot reasoning turn of 25 cents
  const debit1 = ledger.recordTransaction({
    agencyId,
    locationId,
    entryType: 'debit',
    amountCents: 25,
    referenceType: 'copilot_token_usage',
    referenceId: 'turn_001',
    description: 'Copilot Reasoning'
  });

  assert.equal(debit1.ok, true);
  assert.equal(debit1.account.balanceCents, 4975);

  // 4. Debit for Workflow external action of 50 cents
  const debit2 = ledger.recordTransaction({
    agencyId,
    locationId,
    entryType: 'debit',
    amountCents: 50,
    referenceType: 'workflow_action',
    referenceId: 'exec_001',
    description: 'WhatsApp Meta Dispatch'
  });

  assert.equal(debit2.ok, true);
  assert.equal(debit2.account.balanceCents, 4925);
  assert.equal(ledger.getBalance({ agencyId, locationId }), 4925);

  // 5. Verify integrity check
  const integrity = ledger.verifyLedgerIntegrity({ agencyId, locationId });
  assert.equal(integrity.valid, true);
  assert.equal(integrity.entryCount, 3);
  assert.equal(integrity.balanceCents, 4925);

  // 6. Overdraft prevention without allowOverdraft
  assert.throws(() => {
    ledger.recordTransaction({
      agencyId,
      locationId,
      entryType: 'debit',
      amountCents: 10000, // Exceeds 4925
      referenceType: 'copilot_token_usage',
      referenceId: 'turn_fail'
    });
  }, { code: 'INSUFFICIENT_CREDITS' });
});

test('createImmutableAuditStore: appends events and verifies hash-chain tamper-evidence', () => {
  const audit = createImmutableAuditStore();
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  const ev1 = audit.recordEvent({
    agencyId,
    locationId,
    actorId: 'usr_admin',
    actorType: 'user',
    eventName: 'crm.contact.created',
    payload: { contactId: 'c_1', name: 'Alice' }
  });

  const ev2 = audit.recordEvent({
    agencyId,
    locationId,
    actorId: 'copilot_worker',
    actorType: 'copilot_agent',
    eventName: 'copilot.tool.executed',
    payload: { tool: 'crm_update_contact', status: 'success' }
  });

  assert.equal(ev1.prevHash, 'genesis');
  assert.equal(ev2.prevHash, ev1.eventHash);
  assert.ok(ev1.eventHash.length === 64);
  assert.ok(ev2.eventHash.length === 64);

  // Verify chain
  const verify = audit.verifyAuditChain({ agencyId, locationId });
  assert.equal(verify.valid, true);
  assert.equal(verify.count, 2);
});

test('gateAiToolExecution: halts execution when balance insufficient and deducts credits when live', () => {
  const ledger = createBillingLedgerStore();
  const agencyId = '11111111-1111-1111-1111-111111111111';
  const locationId = '22222222-2222-2222-2222-222222222222';

  // Case A: 0 balance -> fails closed
  const denied = gateAiToolExecution({
    ledger,
    agencyId,
    locationId,
    toolName: 'ai_generate_workflow',
    costCents: 50
  });

  assert.equal(denied.allowed, false);
  assert.equal(denied.code, 'INSUFFICIENT_CREDITS');

  // Case B: Top-up balance to 100 cents
  ledger.recordTransaction({
    agencyId,
    locationId,
    entryType: 'credit',
    amountCents: 100,
    referenceType: 'stripe_topup',
    referenceId: 'ch_topup_1'
  });

  // Case C: Dry-run check succeeds without deducting balance
  const preview = gateAiToolExecution({
    ledger,
    agencyId,
    locationId,
    toolName: 'ai_generate_workflow',
    costCents: 50,
    dryRun: true
  });

  assert.equal(preview.allowed, true);
  assert.equal(preview.dryRun, true);
  assert.equal(ledger.getBalance({ agencyId, locationId }), 100);

  // Case D: Live execution succeeds and deducts 50 cents
  const executed = gateAiToolExecution({
    ledger,
    agencyId,
    locationId,
    toolName: 'ai_generate_workflow',
    costCents: 50,
    dryRun: false
  });

  assert.equal(executed.allowed, true);
  assert.equal(executed.remainingBalanceCents, 50);
  assert.equal(ledger.getBalance({ agencyId, locationId }), 50);
});
