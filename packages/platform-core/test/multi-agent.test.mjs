import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultLLMRuntime } from '../src/llm-runtime/index.mjs';
import { MultiAgentOrchestrator, AGENT_ROLES, getAgent } from '../src/multi-agent/index.mjs';

test('getAgent retrieves domain agents with specialized system prompts', () => {
  const supervisor = getAgent('supervisor');
  assert.ok(supervisor);
  assert.equal(supervisor.id, AGENT_ROLES.SUPERVISOR);

  const crm = getAgent('crm');
  assert.ok(crm);
  assert.ok(crm.supportedTools.includes('search_contacts'));

  const automation = getAgent('automation');
  assert.ok(automation);
  assert.ok(automation.supportedTools.includes('inspect_zapier_hooks'));
});

test('MultiAgentOrchestrator executes autonomous handoff from supervisor to crm agent', async () => {
  const runtime = createDefaultLLMRuntime();
  const orchestrator = new MultiAgentOrchestrator({
    llmRuntime: runtime,
    toolExecutor: {
      search_contacts: async ({ query }) => {
        return [{ id: 'con_1', name: query, email: 'sarah@skynet.test' }];
      }
    }
  });

  const events = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Search contacts for Sarah Connor'
  })) {
    events.push(event);
  }

  const handoff = events.find(e => e.type === 'agent_handoff');
  assert.ok(handoff);
  assert.equal(handoff.from, AGENT_ROLES.SUPERVISOR);
  assert.equal(handoff.to, AGENT_ROLES.CRM);

  const toolExec = events.find(e => e.type === 'tool_executing');
  assert.ok(toolExec);
  assert.equal(toolExec.tool, 'search_contacts');
  assert.equal(toolExec.params.query, 'Sarah Connor');

  const toolDone = events.find(e => e.type === 'tool_completed');
  assert.ok(toolDone);
  assert.equal(toolDone.result[0].email, 'sarah@skynet.test');

  const done = events.find(e => e.type === 'done');
  assert.ok(done);
  assert.ok(done.executionChain.includes('crm'));
});

test('MultiAgentOrchestrator converts write requests into pending proposals', async () => {
  let proposalCreated = null;
  const runtime = createDefaultLLMRuntime();
  const orchestrator = new MultiAgentOrchestrator({
    llmRuntime: runtime,
    proposalStore: async (toolName, params) => {
      proposalCreated = { id: 'prop_test_100', toolName, params, status: 'pending_review' };
      return proposalCreated;
    }
  });

  const events = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Create contact named John Connor with email john@resistance.test'
  })) {
    events.push(event);
  }

  const proposalEvent = events.find(e => e.type === 'proposal_created');
  assert.ok(proposalEvent);
  assert.equal(proposalEvent.proposalId, 'prop_test_100');
  assert.equal(proposalEvent.toolName, 'create_contact');
  assert.equal(proposalEvent.status, 'pending_review');
  assert.equal(proposalCreated.params.email, 'john@resistance.test');
});

test('MultiAgentOrchestrator routes workflow generation requests to automation agent and creates proposal', async () => {
  let proposalCreated = null;
  const runtime = createDefaultLLMRuntime();
  const orchestrator = new MultiAgentOrchestrator({
    llmRuntime: runtime,
    proposalStore: async (toolName, params) => {
      proposalCreated = { id: 'prop_wf_01', toolName, params, status: 'pending_review' };
      return proposalCreated;
    }
  });

  const events = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Generate workflow for Enterprise Lead Qualification with Zapier'
  })) {
    events.push(event);
  }

  const handoff = events.find(e => e.type === 'agent_handoff');
  assert.ok(handoff);
  assert.equal(handoff.to, AGENT_ROLES.AUTOMATION);

  const proposalEvent = events.find(e => e.type === 'proposal_created');
  assert.ok(proposalEvent);
  assert.equal(proposalEvent.toolName, 'generate_workflow');
  assert.equal(proposalEvent.status, 'pending_review');
  assert.ok(proposalCreated.params.nodes.length >= 3);
  assert.ok(proposalCreated.params.nodes.some(n => n.type === 'zapier'));
});
