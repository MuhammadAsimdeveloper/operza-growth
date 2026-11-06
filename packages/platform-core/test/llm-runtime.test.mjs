import test from 'node:test';
import assert from 'node:assert/strict';
import { EmbeddedOfflineProvider } from '../src/llm-runtime/providers/embedded-offline.mjs';
import { OllamaProvider } from '../src/llm-runtime/providers/ollama-provider.mjs';
import { LLMRuntimeEngine, createDefaultLLMRuntime } from '../src/llm-runtime/index.mjs';

test('EmbeddedOfflineProvider is always available and generates completions', async () => {
  const provider = new EmbeddedOfflineProvider();
  assert.equal(await provider.isAvailable(), true);

  const res = await provider.complete([
    { role: 'user', content: 'What is Operza pricing?' }
  ]);

  assert.ok(typeof res.text === 'string');
  assert.ok(res.text.includes('Starter'));
  assert.ok(res.text.includes('Growth'));
  assert.ok(res.usage.totalTokens > 0);
});

test('EmbeddedOfflineProvider generates streaming token chunks', async () => {
  const provider = new EmbeddedOfflineProvider();
  const chunks = [];

  for await (const chunk of provider.stream([{ role: 'user', content: 'Hello Copilot' }])) {
    chunks.push(chunk);
  }

  assert.ok(chunks.length > 1);
  const tokenChunks = chunks.filter(c => c.type === 'token');
  const doneChunk = chunks.find(c => c.type === 'done');

  assert.ok(tokenChunks.length > 0);
  assert.equal(doneChunk?.finishReason, 'stop');
});

test('EmbeddedOfflineProvider detects tool calling intent for CRM lookup', async () => {
  const provider = new EmbeddedOfflineProvider();
  const res = await provider.complete(
    [{ role: 'user', content: 'Search contacts for Sarah Connor' }],
    {
      tools: [{ name: 'search_contacts', description: 'Search CRM contacts', parameters: {} }]
    }
  );

  assert.equal(res.toolCalls.length, 1);
  assert.equal(res.toolCalls[0].name, 'search_contacts');
  assert.equal(res.toolCalls[0].arguments.query, 'Sarah Connor');
});

test('LLMRuntimeEngine cascades from unavailable Ollama to Embedded engine', async () => {
  // Create an Ollama provider pointing to a mock unavailable host
  const offlineOllama = new OllamaProvider({
    baseUrl: 'http://127.0.0.1:59999',
    fetchFn: async () => { throw new Error('Connection refused'); }
  });

  const engine = new LLMRuntimeEngine([offlineOllama], ['ollama', 'embedded']);

  const res = await engine.completeWithFallback([
    { role: 'user', content: 'Tell me about Zapier integration' }
  ]);

  assert.equal(res.providerId, 'embedded');
  assert.ok(res.text.includes('Zapier'));
});

test('LLMRuntimeEngine streaming cascade yields tokens without throwing', async () => {
  const offlineOllama = new OllamaProvider({
    baseUrl: 'http://127.0.0.1:59999',
    fetchFn: async () => { throw new Error('Connection refused'); }
  });

  const engine = new LLMRuntimeEngine([offlineOllama], ['ollama', 'embedded']);
  const tokens = [];

  for await (const chunk of engine.streamWithFallback([{ role: 'user', content: 'Hi' }])) {
    if (chunk.type === 'token') tokens.push(chunk.token);
  }

  assert.ok(tokens.length > 0);
});
