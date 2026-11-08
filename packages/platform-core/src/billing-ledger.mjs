import crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTRY_TYPES = new Set(['credit', 'debit']);
const ACCOUNT_TYPES = new Set(['credit_balance', 'stripe_escrow', 'provider_cost_accrual', 'usage_reserve']);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function canonical(value) {
  return JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]]))
    : item);
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function createBillingLedgerStore({
  initialAccounts = [],
  initialEntries = [],
  defaultCreditBalance = 0
} = {}) {
  const accounts = new Map();
  const entries = [];
  const defaultInitialBalance = Number.isSafeInteger(defaultCreditBalance) ? defaultCreditBalance : 0;

  for (const acc of initialAccounts) {
    accounts.set(`${acc.agencyId}:${acc.locationId}:${acc.accountType}`, { ...acc });
  }
  for (const ent of initialEntries) {
    entries.push({ ...ent });
  }

  function getAccountKey(agencyId, locationId, accountType) {
    return `${agencyId}:${locationId}:${accountType}`;
  }

  const store = {
    getOrCreateAccount({ agencyId, locationId, accountType = 'credit_balance', currency = 'USD' }) {
      if (!agencyId || !locationId) fail('MISSING_TENANT_SCOPE', 'agencyId and locationId are required');
      if (!ACCOUNT_TYPES.has(accountType)) fail('INVALID_ACCOUNT_TYPE', `Account type "${accountType}" is invalid`);

      const key = getAccountKey(agencyId, locationId, accountType);
      let account = accounts.get(key);
      if (!account) {
        account = {
          id: crypto.randomUUID(),
          agencyId,
          locationId,
          accountType,
          balanceCents: defaultInitialBalance,
          currency,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        accounts.set(key, account);
      }
      return { ...account };
    },

    getBalance({ agencyId, locationId, accountType = 'credit_balance' }) {
      const key = getAccountKey(agencyId, locationId, accountType);
      let acc = accounts.get(key);
      if (!acc && defaultInitialBalance > 0 && agencyId && locationId) {
        acc = store.getOrCreateAccount({ agencyId, locationId, accountType });
      }
      return acc ? acc.balanceCents : 0;
    },

    recordTransaction({
      agencyId,
      locationId,
      accountType = 'credit_balance',
      entryType,
      amountCents,
      referenceType,
      referenceId,
      description = '',
      allowOverdraft = false
    }) {
      if (!agencyId || !locationId) fail('MISSING_TENANT_SCOPE', 'agencyId and locationId are required');
      if (!ENTRY_TYPES.has(entryType)) fail('INVALID_ENTRY_TYPE', `Entry type "${entryType}" must be "credit" or "debit"`);
      if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
        fail('INVALID_AMOUNT', 'amountCents must be a positive integer greater than 0');
      }

      const key = getAccountKey(agencyId, locationId, accountType);
      let account = accounts.get(key);
      if (!account) {
        account = {
          id: crypto.randomUUID(),
          agencyId,
          locationId,
          accountType,
          balanceCents: 0,
          currency: 'USD',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        accounts.set(key, account);
      }

      const currentBalance = account.balanceCents;
      let newBalance = currentBalance;

      if (entryType === 'credit') {
        newBalance = currentBalance + amountCents;
      } else {
        if (!allowOverdraft && currentBalance < amountCents) {
          fail('INSUFFICIENT_CREDITS', `Insufficient credit balance: available ${currentBalance} cents, required ${amountCents} cents`);
        }
        newBalance = currentBalance - amountCents;
      }

      // Find previous entry for hash chaining
      const accountEntries = entries.filter(e => e.agencyId === agencyId && e.locationId === locationId && e.accountId === account.id);
      const prevChecksum = accountEntries.length > 0 ? accountEntries[accountEntries.length - 1].checksum : 'genesis';

      const entryId = crypto.randomUUID();
      const checksumInput = `${agencyId}:${locationId}:${account.id}:${entryType}:${amountCents}:${newBalance}:${prevChecksum}`;
      const checksum = hash(checksumInput);

      const entry = {
        id: entryId,
        agencyId,
        locationId,
        accountId: account.id,
        entryType,
        amountCents,
        runningBalanceCents: newBalance,
        referenceType: referenceType || 'manual_adjustment',
        referenceId: referenceId || entryId,
        description,
        checksum,
        createdAt: new Date().toISOString()
      };

      entries.push(entry);
      account.balanceCents = newBalance;
      account.updatedAt = entry.createdAt;

      return {
        ok: true,
        entry: { ...entry },
        account: { ...account }
      };
    },

    getEntries({ agencyId, locationId, accountType = 'credit_balance', limit = 50 }) {
      const key = getAccountKey(agencyId, locationId, accountType);
      const account = accounts.get(key);
      if (!account) return [];

      return entries
        .filter(e => e.agencyId === agencyId && e.locationId === locationId && e.accountId === account.id)
        .slice(-limit);
    },

    verifyLedgerIntegrity({ agencyId, locationId, accountType = 'credit_balance' }) {
      const key = getAccountKey(agencyId, locationId, accountType);
      const account = accounts.get(key);
      if (!account) return { valid: true, entryCount: 0, balanceCents: 0 };

      const accountEntries = entries.filter(e => e.agencyId === agencyId && e.locationId === locationId && e.accountId === account.id);
      let runningChecksum = 'genesis';
      let calculatedBalance = 0;

      for (let idx = 0; idx < accountEntries.length; idx++) {
        const ent = accountEntries[idx];
        if (ent.entryType === 'credit') {
          calculatedBalance += ent.amountCents;
        } else {
          calculatedBalance -= ent.amountCents;
        }

        if (calculatedBalance !== ent.runningBalanceCents) {
          return {
            valid: false,
            error: `Running balance mismatch at entry ${ent.id}: expected ${calculatedBalance}, found ${ent.runningBalanceCents}`,
            index: idx
          };
        }

        const expectedChecksum = hash(`${agencyId}:${locationId}:${account.id}:${ent.entryType}:${ent.amountCents}:${ent.runningBalanceCents}:${runningChecksum}`);
        if (ent.checksum !== expectedChecksum) {
          return {
            valid: false,
            error: `Checksum tampering detected at entry ${ent.id}`,
            index: idx
          };
        }

        runningChecksum = ent.checksum;
      }

      if (calculatedBalance !== account.balanceCents) {
        return {
          valid: false,
          error: `Account balance mismatch: computed ${calculatedBalance}, stored ${account.balanceCents}`
        };
      }

      return {
        valid: true,
        entryCount: accountEntries.length,
        balanceCents: account.balanceCents
      };
    }
  };

  return store;
}

/**
 * Immutable Audit Trail with cryptographic hash chaining.
 */
export function createImmutableAuditStore() {
  const events = [];

  return {
    recordEvent({
      agencyId,
      locationId,
      actorId,
      actorType = 'user',
      eventName,
      payload = {},
      clientIp = null,
      userAgent = null
    }) {
      if (!agencyId || !locationId || !actorId || !eventName) {
        fail('INVALID_AUDIT_INPUT', 'agencyId, locationId, actorId, and eventName are required');
      }

      const tenantEvents = events.filter(e => e.agencyId === agencyId && e.locationId === locationId);
      const prevHash = tenantEvents.length > 0 ? tenantEvents[tenantEvents.length - 1].eventHash : 'genesis';

      const payloadStr = canonical(payload);
      const hashInput = `${agencyId}:${locationId}:${actorId}:${eventName}:${payloadStr}:${prevHash}`;
      const eventHash = hash(hashInput);

      const event = Object.freeze({
        id: crypto.randomUUID(),
        agencyId,
        locationId,
        actorId,
        actorType,
        eventName,
        payload: structuredClone(payload),
        clientIp,
        userAgent,
        eventHash,
        prevHash,
        createdAt: new Date().toISOString()
      });

      events.push(event);
      return event;
    },

    getEvents({ agencyId, locationId, limit = 50 }) {
      return events
        .filter(e => e.agencyId === agencyId && e.locationId === locationId)
        .slice(-limit);
    },

    verifyAuditChain({ agencyId, locationId }) {
      const tenantEvents = events.filter(e => e.agencyId === agencyId && e.locationId === locationId);
      let expectedPrev = 'genesis';

      for (let i = 0; i < tenantEvents.length; i++) {
        const ev = tenantEvents[i];
        if (ev.prevHash !== expectedPrev) {
          return { valid: false, error: `Audit chain broken at event ${ev.id}`, brokenIndex: i };
        }
        const calcHash = hash(`${agencyId}:${locationId}:${ev.actorId}:${ev.eventName}:${canonical(ev.payload)}:${expectedPrev}`);
        if (ev.eventHash !== calcHash) {
          return { valid: false, error: `Audit event hash tampered at ${ev.id}`, brokenIndex: i };
        }
        expectedPrev = ev.eventHash;
      }

      return { valid: true, count: tenantEvents.length };
    }
  };

  return store;
}

/**
 * Gating function to check and debit account credits before billable AI operations.
 */
export function gateAiToolExecution({
  ledger,
  agencyId,
  locationId,
  toolName,
  costCents = 10,
  dryRun = false,
  metadata = {}
}) {
  if (!ledger) fail('LEDGER_REQUIRED', 'A billing ledger is required');

  const currentBalance = ledger.getBalance({ agencyId, locationId, accountType: 'credit_balance' });

  if (currentBalance < costCents) {
    return {
      allowed: false,
      code: 'INSUFFICIENT_CREDITS',
      error: `Action requires ${costCents} credits ($${(costCents / 100).toFixed(2)}), but location balance is ${currentBalance} credits ($${(currentBalance / 100).toFixed(2)})`,
      balanceCents: currentBalance,
      costCents
    };
  }

  if (dryRun) {
    return {
      allowed: true,
      dryRun: true,
      balanceCents: currentBalance,
      costCents
    };
  }

  const result = ledger.recordTransaction({
    agencyId,
    locationId,
    accountType: 'credit_balance',
    entryType: 'debit',
    amountCents: costCents,
    referenceType: 'copilot_token_usage',
    referenceId: metadata.turnId || `turn_${crypto.randomUUID().slice(0, 12)}`,
    description: `Copilot AI Tool Execution: ${toolName}`
  });

  return {
    allowed: true,
    dryRun: false,
    costCents,
    remainingBalanceCents: result.account.balanceCents,
    transactionId: result.entry.id
  };
}
