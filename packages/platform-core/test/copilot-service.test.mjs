import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAIProvider,
  buildSystemPrompt,
  RAGEngine,
  ToolRegistry,
  CopilotService,
  TestMockProvider
} from '../src/copilot/index.mjs';

test('resolveAIProvider returns TestMockProvider in test environment', () => {
  const provider = resolveAIProvider();
  assert.equal(provider.id, 'test-mock');
  assert.equal(provider.isConfigured(), true);
});

test('buildSystemPrompt includes Operza product knowledge and Roman Urdu instructions', () => {
  const prompt = buildSystemPrompt({
    agency: { name: 'Apex Growth Inc', id: 'ag_123' },
    activeLocation: { name: 'Main HQ', id: 'loc_456' },
    actor: { user: { name: 'Asim' }, membership: { role: 'owner' } },
    activeModule: 'Visual Workflows (/workflows)',
    retrievedSources: [
      { title: 'Agency Pricing Retainers', chunkId: 'chk_1', text: 'Growth Retainer is $2500/month.' }
    ]
  });

  assert.ok(prompt.includes('Operza Copilot'));
  assert.ok(prompt.includes('Roman Urdu'));
  assert.ok(prompt.includes('Visual Workflows (/workflows)'));
  assert.ok(prompt.includes('Agency Pricing Retainers'));
  assert.ok(prompt.includes('Growth Retainer is $2500/month.'));
  assert.ok(prompt.includes('Apex Growth Inc'));
});

test('RAGEngine chunks documents and performs hybrid retrieval with strict tenant isolation', () => {
  const rag = new RAGEngine();
  const agencyA = 'ag_tenant_alpha';
  const agencyB = 'ag_tenant_beta';

  const docA = rag.indexDocument({
    agencyId: agencyA,
    title: 'Customer Onboarding SOP',
    content: `When a customer signs up for our enterprise growth retainer, send welcome email within 5 minutes.
Schedule onboarding consultation on calendars (/calendars). Set up pipeline deal in opportunities (/opportunities).`
  });

  const docB = rag.indexDocument({
    agencyId: agencyB,
    title: 'Confidential Beta Strategy',
    content: `Project Secret Nova pricing is $99,000. Do not share with other tenants.`
  });

  const allDocs = [docA, docB];

  // Search by agencyA
  const resultsA = rag.searchKnowledge({
    query: 'How to onboard a new customer retainer?',
    agencyId: agencyA,
    documents: allDocs,
    topK: 3
  });

  assert.ok(resultsA.length > 0);
  assert.equal(resultsA[0].docId, docA.id);
  assert.ok(resultsA[0].text.includes('enterprise growth retainer'));

  // Ensure agencyA query NEVER returns agencyB document (strict tenant isolation)
  const leakCheck = resultsA.some((r) => r.docId === docB.id);
  assert.equal(leakCheck, false, 'Tenant isolation breached: Agency B document leaked to Agency A');
});

test('ToolRegistry executes read tools and creates proposals for write tools', async () => {
  const registry = new ToolRegistry();
  const state = {
    records: {
      contacts: [
        { id: 'c1', agencyId: 'ag_1', firstName: 'John', lastName: 'Connor', email: 'john@resistance.org', company: 'TechCom' }
      ],
      opportunities: [
        { id: 'o1', agencyId: 'ag_1', name: 'Cyberdyne Deal', stage: 'Qualified', value: 15000 }
      ]
    },
    copilotProposals: []
  };

  // 1. Read tool: search_contacts
  const searchRes = await registry.executeTool({
    toolName: 'search_contacts',
    params: { query: 'Connor' },
    actor: { membership: { role: 'member' } },
    agency: { id: 'ag_1' },
    activeLocation: { id: 'loc_1' },
    state
  });

  assert.equal(searchRes.ok, true);
  assert.equal(searchRes.results.length, 1);
  assert.equal(searchRes.results[0].name, 'John Connor');

  // 2. Write tool: create_contact (Must generate proposal, NOT direct write)
  const createRes = await registry.executeTool({
    toolName: 'create_contact',
    params: { firstName: 'Sarah', lastName: 'Connor', email: 'sarah@resistance.org' },
    actor: { membership: { role: 'member' } },
    agency: { id: 'ag_1' },
    activeLocation: { id: 'loc_1' },
    state
  });

  assert.equal(createRes.ok, true);
  assert.equal(createRes.isProposal, true);
  assert.equal(createRes.status, 'pending_review');
  assert.ok(createRes.proposalId);
  assert.equal(state.copilotProposals.length, 1);
});

test('CopilotService completes multilingual requests and retains multi-turn memory', async () => {
  const service = new CopilotService({ forceMock: true });
  const sessionId = 'session_test_multiturn';
  const state = {
    records: {
      contacts: [],
      knowledge: []
    },
    copilotProposals: []
  };

  // Turn 1: Roman Urdu business question
  const turn1 = await service.chat({
    message: 'Mera business grow nahi ho raha, kya karun?',
    sessionId,
    agency: { id: 'ag_test', name: 'Karachi Digital' },
    activeLocation: { id: 'loc_test' },
    actor: { user: { name: 'Tariq' }, membership: { role: 'owner' } },
    state
  });

  assert.ok(turn1.message.content.includes('grow'));
  assert.equal(turn1.historyLength, 2);

  // Turn 2: Follow-up question
  const turn2 = await service.chat({
    message: 'Make it cheaper and focus on free organic leads',
    sessionId,
    agency: { id: 'ag_test', name: 'Karachi Digital' },
    activeLocation: { id: 'loc_test' },
    actor: { user: { name: 'Tariq' }, membership: { role: 'owner' } },
    state
  });

  assert.ok(turn2.message.content.length > 20);
  assert.equal(turn2.historyLength, 4);

  service.destroy();
});

test('CopilotService chatStream yields tokens and done event', async () => {
  const service = new CopilotService({ forceMock: true });
  const state = { records: { knowledge: [] } };

  const chunks = [];
  for await (const chunk of service.chatStream({
    message: 'How do I automate lead onboarding in Operza?',
    sessionId: 'stream_test_session',
    agency: { id: 'ag_stream', name: 'Stream Corp' },
    activeLocation: { id: 'loc_stream' },
    actor: { user: { name: 'Alex' }, membership: { role: 'admin' } },
    state
  })) {
    chunks.push(chunk);
  }

  const tokenChunks = chunks.filter((c) => c.type === 'token');
  const doneChunk = chunks.find((c) => c.type === 'done');

  assert.ok(tokenChunks.length > 0, 'No token chunks received');
  assert.ok(doneChunk, 'No done event emitted');
  assert.ok(doneChunk.completeText.length > 10);

  service.destroy();
});
