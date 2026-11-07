import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultLLMRuntime } from '../src/llm-runtime/index.mjs';
import { MultiAgentOrchestrator, AGENT_ROLES, getAgent, DOMAIN_AGENTS } from '../src/multi-agent/index.mjs';

test('getAgent retrieves domain agents with specialized system prompts across 10-agent team', () => {
  assert.equal(DOMAIN_AGENTS.length, 10);

  const roles = [
    AGENT_ROLES.SUPERVISOR,
    AGENT_ROLES.CRM,
    AGENT_ROLES.MARKETING,
    AGENT_ROLES.AUTOMATION,
    AGENT_ROLES.SUPPORT,
    AGENT_ROLES.SALES,
    AGENT_ROLES.ANALYTICS,
    AGENT_ROLES.WEBSITE_BUILDER,
    AGENT_ROLES.INTEGRATION,
    AGENT_ROLES.DEVELOPER
  ];

  for (const role of roles) {
    const agent = getAgent(role);
    assert.ok(agent, `Agent for role ${role} must exist`);
    assert.equal(agent.id, role);
    assert.ok(agent.systemPrompt && agent.systemPrompt.length > 50);
    assert.ok(agent.supportedTools.length > 0);
  }
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

test('MultiAgentOrchestrator routes marketing, sales, analytics, and dev requests to specialized agents', async () => {
  let lastProposal = null;
  const runtime = createDefaultLLMRuntime();
  const orchestrator = new MultiAgentOrchestrator({
    llmRuntime: runtime,
    toolExecutor: {
      get_pipeline_velocity: async () => ({ velocityDays: 12.5, conversionRate: 0.35 })
    },
    proposalStore: async (toolName, params) => {
      lastProposal = { id: 'prop_spec_01', toolName, params, status: 'pending_review' };
      return lastProposal;
    }
  });

  // 1. Marketing Agent Handoff
  const mktEvents = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Create campaign named Product Launch Email Drip'
  })) {
    mktEvents.push(event);
  }
  const mktHandoff = mktEvents.find(e => e.type === 'agent_handoff');
  assert.ok(mktHandoff);
  assert.equal(mktHandoff.to, AGENT_ROLES.MARKETING);
  const mktProp = mktEvents.find(e => e.type === 'proposal_created');
  assert.ok(mktProp);
  assert.equal(mktProp.toolName, 'create_campaign');

  // 2. Sales Agent Handoff
  const salesEvents = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Create payment link for Enterprise Tier subscription'
  })) {
    salesEvents.push(event);
  }
  const salesHandoff = salesEvents.find(e => e.type === 'agent_handoff');
  assert.ok(salesHandoff);
  assert.equal(salesHandoff.to, AGENT_ROLES.SALES);
  const salesProp = salesEvents.find(e => e.type === 'proposal_created');
  assert.ok(salesProp);
  assert.equal(salesProp.toolName, 'create_payment_link');

  // 3. Analytics Agent Handoff
  const anaEvents = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Show me pipeline velocity KPIs for executive reporting'
  })) {
    anaEvents.push(event);
  }
  const anaHandoff = anaEvents.find(e => e.type === 'agent_handoff');
  assert.ok(anaHandoff);
  assert.equal(anaHandoff.to, AGENT_ROLES.ANALYTICS);
  const anaTool = anaEvents.find(e => e.type === 'tool_completed');
  assert.ok(anaTool);
  assert.equal(anaTool.result.velocityDays, 12.5);

  // 4. Developer Agent Handoff
  const devEvents = [];
  for await (const event of orchestrator.processUserMessageStream({
    message: 'Generate api key for external developer access'
  })) {
    devEvents.push(event);
  }
  const devHandoff = devEvents.find(e => e.type === 'agent_handoff');
  assert.ok(devHandoff);
  assert.equal(devHandoff.to, AGENT_ROLES.DEVELOPER);
  const devProp = devEvents.find(e => e.type === 'proposal_created');
  assert.ok(devProp);
  assert.equal(devProp.toolName, 'generate_api_key');
});

test('MultiAgentOrchestrator domain agents contain omniscient Operza knowledge base and multilingual guidelines', () => {
  for (const agent of DOMAIN_AGENTS) {
    assert.ok(agent.systemPrompt.includes('OPERZA — THE UNIFIED BUSINESS OPERATING SYSTEM'), `Agent ${agent.id} missing knowledge base`);
    assert.ok(agent.systemPrompt.includes('/workflows'), `Agent ${agent.id} missing /workflows route`);
    assert.ok(agent.systemPrompt.includes('/contacts'), `Agent ${agent.id} missing /contacts route`);
    assert.ok(agent.systemPrompt.includes('/conversations'), `Agent ${agent.id} missing /conversations route`);
    assert.ok(agent.systemPrompt.includes('MULTILINGUAL & NAVIGATION RULES'), `Agent ${agent.id} missing multilingual rules`);
  }
});

test('LLM Runtime Embedded Provider answers multilingual questions about Operza with route navigation', async () => {
  const runtime = createDefaultLLMRuntime();

  // Spanish query
  const resEs = await runtime.completeWithFallback([
    { role: 'user', content: '¿Cómo puedo agregar un contacto en el CRM de Operza?' }
  ], { preferredProvider: 'embedded' });
  assert.ok(resEs.text.includes('/contacts'));
  assert.ok(resEs.text.toLowerCase().includes('contacto') || resEs.text.toLowerCase().includes('operza'));

  // French query
  const resFr = await runtime.completeWithFallback([
    { role: 'user', content: 'Comment créer une automatisation visuelle dans Operza?' }
  ], { preferredProvider: 'embedded' });
  assert.ok(resFr.text.includes('/workflows'));
  assert.ok(resFr.text.toLowerCase().includes('flux') || resFr.text.toLowerCase().includes('operza'));

  // German query
  const resDe = await runtime.completeWithFallback([
    { role: 'user', content: 'Wie erstelle ich einen Workflow in Operza?' }
  ], { preferredProvider: 'embedded' });
  assert.ok(resDe.text.includes('/workflows'));

  // Urdu query
  const resUr = await runtime.completeWithFallback([
    { role: 'user', content: 'اوپرزا میں ورک فلو اور میسجز کہاں ہیں؟' }
  ], { preferredProvider: 'embedded' });
  assert.ok(resUr.text.includes('اوپر زا') || resUr.text.includes('Operza'));
  assert.ok(resUr.text.includes('/contacts') || resUr.text.includes('/workflows'));

  // Arabic query
  const resAr = await runtime.completeWithFallback([
    { role: 'user', content: 'كيف يمكنني استخدام نظام الهاتف ومسارات العمل في أوبيرزا؟' }
  ], { preferredProvider: 'embedded' });
  assert.ok(resAr.text.includes('Operza') || resAr.text.includes('أوبيرزا'));
  assert.ok(resAr.text.includes('/phone') || resAr.text.includes('/workflows') || resAr.text.includes('/contacts'));
});
