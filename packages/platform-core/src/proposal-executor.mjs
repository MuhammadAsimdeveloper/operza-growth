import { randomUUID } from 'node:crypto';
import { gateAiToolExecution } from './billing-ledger.mjs';

/**
 * Authoritative Governed Copilot Proposal Executor
 * Executes approved write proposals with audited action receipts.
 */
export async function executeCopilotProposal({
  proposal,
  actor,
  handlers = {},
  now = Date.now(),
  ledger = null,
  toolCostCents = 10
} = {}) {
  if (!proposal || typeof proposal !== 'object') {
    return { ok: false, code: 'INVALID_PROPOSAL', message: 'Proposal object is required' };
  }
  if (proposal.status !== 'approved') {
    return {
      ok: false,
      code: 'PROPOSAL_NOT_APPROVED',
      message: `Proposal status is "${proposal.status}". Only approved proposals can be executed.`
    };
  }

  const role = actor?.membership?.role || actor?.role;
  if (!['owner', 'admin'].includes(role)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED_EXECUTOR',
      message: 'Only workspace owners and administrators can execute approved proposals'
    };
  }

  const handler = handlers[proposal.toolName];
  if (typeof handler !== 'function') {
    return {
      ok: false,
      code: 'HANDLER_NOT_FOUND',
      message: `No execution handler registered for tool: ${proposal.toolName}`
    };
  }

  // Credit entitlement gating for mutating AI tool execution
  if (ledger) {
    const gateResult = gateAiToolExecution({
      ledger,
      agencyId: proposal.tenantId,
      locationId: proposal.locationId,
      toolName: proposal.toolName,
      costCents: toolCostCents,
      dryRun: false,
      metadata: { proposalId: proposal.id }
    });

    if (!gateResult.allowed) {
      return {
        ok: false,
        code: gateResult.code || 'INSUFFICIENT_CREDITS',
        message: gateResult.error || 'Insufficient credits for AI tool execution',
        balanceCents: gateResult.balanceCents,
        costCents: gateResult.costCents
      };
    }
  }

  try {
    const executionResult = await handler(proposal.params, {
      tenantId: proposal.tenantId,
      locationId: proposal.locationId,
      actor
    });

    const timestamp = new Date(now).toISOString();
    const receiptId = `rcpt_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

    const receipt = {
      id: receiptId,
      proposalId: proposal.id,
      tenantId: proposal.tenantId,
      locationId: proposal.locationId,
      toolName: proposal.toolName,
      executedByActorId: actor?.user?.id || actor?.id,
      executedAt: timestamp,
      entityId: executionResult?.id || executionResult?.contactId || executionResult?.appointmentId || null,
      result: executionResult,
      diff: {
        tool: proposal.toolName,
        params: proposal.params,
        outcome: executionResult
      }
    };

    const updatedProposal = {
      ...proposal,
      status: 'executed',
      executedAt: timestamp,
      executedByActorId: actor?.user?.id || actor?.id,
      receiptId
    };

    return {
      ok: true,
      code: 'PROPOSAL_EXECUTED',
      proposal: updatedProposal,
      receipt
    };
  } catch (err) {
    return {
      ok: false,
      code: 'EXECUTION_FAILED',
      message: err.message || 'Mutation failed during proposal execution'
    };
  }
}
