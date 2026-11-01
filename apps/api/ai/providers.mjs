/**
 * Operza Copilot — Multi-Provider AI Architecture
 * Provides unified, extensible adapters for OpenAI, Anthropic Claude, Google Gemini, Ollama & Local execution.
 */

export const MODEL_CATALOG = [
  {
    id: 'gpt-4o',
    name: 'OpenAI GPT-4o',
    provider: 'openai',
    contextWindow: 128000,
    costPer1kPrompt: 0.005,
    costPer1kCompletion: 0.015,
    supportsTools: true,
    supportsVision: true,
    defaultFor: 'general'
  },
  {
    id: 'gpt-4o-mini',
    name: 'OpenAI GPT-4o Mini',
    provider: 'openai',
    contextWindow: 128000,
    costPer1kPrompt: 0.00015,
    costPer1kCompletion: 0.0006,
    supportsTools: true,
    supportsVision: true,
    defaultFor: 'fast'
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Anthropic Claude 3.5 Sonnet',
    provider: 'anthropic',
    contextWindow: 200000,
    costPer1kPrompt: 0.003,
    costPer1kCompletion: 0.015,
    supportsTools: true,
    supportsVision: true,
    defaultFor: 'reasoning'
  },
  {
    id: 'claude-3-haiku',
    name: 'Anthropic Claude 3 Haiku',
    provider: 'anthropic',
    contextWindow: 200000,
    costPer1kPrompt: 0.00025,
    costPer1kCompletion: 0.00125,
    supportsTools: true,
    supportsVision: false,
    defaultFor: 'light'
  },
  {
    id: 'gemini-1.5-pro',
    name: 'Google Gemini 1.5 Pro',
    provider: 'gemini',
    contextWindow: 1000000,
    costPer1kPrompt: 0.0035,
    costPer1kCompletion: 0.0105,
    supportsTools: true,
    supportsVision: true,
    defaultFor: 'multimodal'
  },
  {
    id: 'gemini-1.5-flash',
    name: 'Google Gemini 1.5 Flash',
    provider: 'gemini',
    contextWindow: 1000000,
    costPer1kPrompt: 0.000075,
    costPer1kCompletion: 0.0003,
    supportsTools: true,
    supportsVision: true,
    defaultFor: 'high_volume'
  },
  {
    id: 'ollama-llama3',
    name: 'Ollama (Llama 3 8B)',
    provider: 'ollama',
    contextWindow: 8192,
    costPer1kPrompt: 0.0,
    costPer1kCompletion: 0.0,
    supportsTools: true,
    supportsVision: false,
    defaultFor: 'private_local'
  }
];

export function getModelMetadata(modelId) {
  return (
    MODEL_CATALOG.find(m => m.id === modelId) || {
      id: modelId,
      name: modelId,
      provider: 'openai',
      contextWindow: 32000,
      costPer1kPrompt: 0.001,
      costPer1kCompletion: 0.002,
      supportsTools: true,
      supportsVision: false
    }
  );
}

export function getActiveProviders(env = process.env, agencyIntegrations = []) {
  const findIntegrationKey = (id) => {
    const found = agencyIntegrations.find(i => i.id === id && i.connected);
    return found?.config?.apiKey || null;
  };

  return {
    openai: {
      available: Boolean(env.OPENAI_API_KEY || findIntegrationKey('openai')),
      keySource: env.OPENAI_API_KEY ? 'env' : findIntegrationKey('openai') ? 'agency_settings' : 'none',
      models: MODEL_CATALOG.filter(m => m.provider === 'openai')
    },
    anthropic: {
      available: Boolean(env.ANTHROPIC_API_KEY || findIntegrationKey('claude')),
      keySource: env.ANTHROPIC_API_KEY ? 'env' : findIntegrationKey('claude') ? 'agency_settings' : 'none',
      models: MODEL_CATALOG.filter(m => m.provider === 'anthropic')
    },
    gemini: {
      available: Boolean(env.GEMINI_API_KEY || findIntegrationKey('gemini')),
      keySource: env.GEMINI_API_KEY ? 'env' : findIntegrationKey('gemini') ? 'agency_settings' : 'none',
      models: MODEL_CATALOG.filter(m => m.provider === 'gemini')
    },
    ollama: {
      available: Boolean(env.OLLAMA_BASE_URL || findIntegrationKey('ollama')),
      keySource: env.OLLAMA_BASE_URL ? 'env' : findIntegrationKey('ollama') ? 'agency_settings' : 'none',
      models: MODEL_CATALOG.filter(m => m.provider === 'ollama')
    }
  };
}

/**
 * Unified dispatch for AI completion requests across any supported provider.
 */
export async function executeAiCompletion({
  provider = 'openai',
  model = 'gpt-4o',
  messages = [],
  systemPrompt = '',
  tools = [],
  temperature = 0.7,
  maxTokens = 2048,
  stream = false,
  onToken = null,
  apiKeyOverride = null,
  agencyIntegrations = []
}) {
  const modelMeta = getModelMetadata(model);
  const selectedProvider = modelMeta.provider || provider;

  // Resolve API key
  let apiKey = apiKeyOverride;
  if (!apiKey) {
    if (selectedProvider === 'openai') {
      apiKey = process.env.OPENAI_API_KEY || agencyIntegrations.find(i => i.id === 'openai' && i.connected)?.config?.apiKey;
    } else if (selectedProvider === 'anthropic') {
      apiKey = process.env.ANTHROPIC_API_KEY || agencyIntegrations.find(i => i.id === 'claude' && i.connected)?.config?.apiKey;
    } else if (selectedProvider === 'gemini') {
      apiKey = process.env.GEMINI_API_KEY || agencyIntegrations.find(i => i.id === 'gemini' && i.connected)?.config?.apiKey;
    }
  }

  // 1. OpenAI Adapter
  if (selectedProvider === 'openai' && apiKey) {
    return await callOpenAi({
      apiKey,
      model,
      messages,
      systemPrompt,
      tools,
      temperature,
      maxTokens,
      stream,
      onToken
    });
  }

  // 2. Anthropic Adapter
  if (selectedProvider === 'anthropic' && apiKey) {
    return await callAnthropic({
      apiKey,
      model,
      messages,
      systemPrompt,
      tools,
      temperature,
      maxTokens,
      stream,
      onToken
    });
  }

  // 3. Google Gemini Adapter
  if (selectedProvider === 'gemini' && apiKey) {
    return await callGemini({
      apiKey,
      model,
      messages,
      systemPrompt,
      tools,
      temperature,
      maxTokens,
      stream,
      onToken
    });
  }

  // 4. Ollama Adapter (Local HTTP)
  if (selectedProvider === 'ollama') {
    const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
    return await callOllama({
      baseUrl,
      model,
      messages,
      systemPrompt,
      tools,
      temperature,
      stream,
      onToken
    });
  }

  // 5. Grounded Deterministic Engine (Zero cloud egress, fully truth-anchored)
  return await callDeterministicAssistant({
    model,
    messages,
    systemPrompt,
    tools,
    stream,
    onToken
  });
}

// ==========================================
// ADAPTER IMPLEMENTATIONS
// ==========================================

async function callOpenAi({ apiKey, model, messages, systemPrompt, tools, temperature, maxTokens, stream, onToken }) {
  const formattedMessages = [];
  if (systemPrompt) {
    formattedMessages.push({ role: 'system', content: systemPrompt });
  }
  for (const m of messages) {
    formattedMessages.push({
      role: m.role,
      content: m.content || '',
      ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {})
    });
  }

  const payload = {
    model,
    messages: formattedMessages,
    temperature,
    max_tokens: maxTokens,
    stream: Boolean(stream && onToken)
  };

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.id,
        description: t.description,
        parameters: t.parameters
      }
    }));
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
  }

  if (payload.stream) {
    let fullContent = '';
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              onToken(delta);
            }
          } catch { /* skip partial chunk */ }
        }
      }
    }

    return {
      content: fullContent,
      toolCalls: [],
      provider: 'openai',
      model,
      promptTokens: Math.ceil((systemPrompt.length + fullContent.length) / 4),
      completionTokens: Math.ceil(fullContent.length / 4)
    };
  }

  const data = await response.json();
  const choice = data.choices?.[0];
  const toolCalls = (choice?.message?.tool_calls || []).map(tc => ({
    id: tc.id,
    name: tc.function?.name,
    parameters: JSON.parse(tc.function?.arguments || '{}')
  }));

  return {
    content: choice?.message?.content || '',
    toolCalls,
    provider: 'openai',
    model,
    promptTokens: data.usage?.prompt_tokens || 100,
    completionTokens: data.usage?.completion_tokens || 50
  };
}

async function callAnthropic({ apiKey, model, messages, systemPrompt, tools, temperature, maxTokens, stream, onToken }) {
  const formattedMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: m.content || ''
  }));

  const payload = {
    model: model.includes('claude') ? model : 'claude-3-5-sonnet-20241022',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: formattedMessages,
    temperature
  };

  if (tools && tools.length > 0) {
    payload.tools = tools.map(t => ({
      name: t.id,
      description: t.description,
      input_schema: t.parameters
    }));
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API Error (${response.status}): ${err}`);
  }

  const data = await response.json();
  let content = '';
  const toolCalls = [];

  for (const block of data.content || []) {
    if (block.type === 'text') content += block.text;
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        parameters: block.input || {}
      });
    }
  }

  if (stream && onToken && content) {
    onToken(content);
  }

  return {
    content,
    toolCalls,
    provider: 'anthropic',
    model,
    promptTokens: data.usage?.input_tokens || 100,
    completionTokens: data.usage?.output_tokens || 50
  };
}

async function callGemini({ apiKey, model, messages, systemPrompt, tools, temperature }) {
  const geminiModel = model.includes('gemini') ? model : 'gemini-1.5-flash';
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content || '' }]
  }));

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 2048
    }
  };

  if (systemPrompt) {
    payload.systemInstruction = { parts: [{ text: systemPrompt }] };
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google Gemini API Error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.map(p => p.text).join('') || '';

  return {
    content: text,
    toolCalls: [],
    provider: 'gemini',
    model: geminiModel,
    promptTokens: data.usageMetadata?.promptTokenCount || 80,
    completionTokens: data.usageMetadata?.candidatesTokenCount || 40
  };
}

async function callOllama({ baseUrl, model, messages, systemPrompt, tools, temperature, stream, onToken }) {
  const cleanModel = model.replace('ollama-', '');
  const formatted = [];
  if (systemPrompt) formatted.push({ role: 'system', content: systemPrompt });
  messages.forEach(m => formatted.push({ role: m.role, content: m.content || '' }));

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cleanModel || 'llama3',
        messages: formatted,
        options: { temperature },
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama server returned ${response.status}`);
    }

    const data = await response.json();
    const content = data.message?.content || '';

    if (stream && onToken && content) {
      onToken(content);
    }

    return {
      content,
      toolCalls: [],
      provider: 'ollama',
      model: cleanModel,
      promptTokens: data.prompt_eval_count || 50,
      completionTokens: data.eval_count || 40
    };
  } catch (err) {
    throw new Error(`Cannot connect to local Ollama instance at ${baseUrl}: ${err.message}`);
  }
}

/**
 * Grounded deterministic fallback engine.
 * Dispatches recognized tools and answers using structured Operza domain intelligence.
 * Strictly avoids fake claims or simulated LLM personas.
 */
async function callDeterministicAssistant({ model, messages, systemPrompt, tools, stream, onToken }) {
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';
  const lower = lastUserMsg.toLowerCase();
  const toolCalls = [];

  // Match domain intents to registered tools
  if (lower.includes('metric') || lower.includes('kpi') || lower.includes('overview') || lower.includes('stats') || lower.includes('how is my agency doing') || lower.includes('agency status') || lower.includes('health')) {
    toolCalls.push({
      id: `tc_${Date.now()}_1`,
      name: 'reporting_agency_metrics',
      parameters: {}
    });
  } else if (lower.includes('revenue') || lower.includes('sales summary') || lower.includes('closed deals')) {
    toolCalls.push({
      id: `tc_${Date.now()}_2`,
      name: 'reporting_revenue_summary',
      parameters: {}
    });
  } else if (lower.includes('search contact') || lower.includes('find contact') || lower.includes('look up contact')) {
    const qMatch = lastUserMsg.match(/(?:search|find|look up)\s+(?:contact[s]?\s+)?(?:for\s+)?["']?(.+?)["']?$/i);
    toolCalls.push({
      id: `tc_${Date.now()}_3`,
      name: 'crm_search_contacts',
      parameters: { query: qMatch ? qMatch[1].trim() : '' }
    });
  } else if (lower.includes('duplicate') && lower.includes('contact')) {
    toolCalls.push({
      id: `tc_${Date.now()}_4`,
      name: 'crm_find_duplicates',
      parameters: {}
    });
  } else if (lower.includes('create deal') || lower.includes('new deal') || lower.includes('add opportunity') || lower.includes('create opportunity')) {
    const valMatch = lastUserMsg.match(/\$?(\d[\d,]*)/);
    const numVal = valMatch ? Number(valMatch[1].replace(/,/g, '')) : 5000;
    const nameMatch = lastUserMsg.match(/(?:deal|opportunity)\s+["']?([^"'\n$]+?)["']?(?:\s+for|\s+worth|\s+\$|$)/i);
    toolCalls.push({
      id: `tc_${Date.now()}_5`,
      name: 'crm_create_opportunity',
      parameters: {
        name: nameMatch ? nameMatch[1].trim() : 'Strategic Client Retainer',
        value: numVal,
        stage: 'Qualified'
      }
    });
  } else if (lower.includes('create contact') || lower.includes('add lead') || lower.includes('new lead')) {
    const emailMatch = lastUserMsg.match(/[\w.-]+@[\w.-]+\.\w+/);
    const nameMatch = lastUserMsg.match(/(?:lead|contact)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
    toolCalls.push({
      id: `tc_${Date.now()}_6`,
      name: 'crm_create_contact',
      parameters: {
        name: nameMatch ? nameMatch[1].trim() : 'New Inbound Lead',
        email: emailMatch ? emailMatch[0] : '',
        tags: ['copilot-lead']
      }
    });
  } else if (lower.includes('calendar') || lower.includes('availability') || lower.includes('schedule')) {
    toolCalls.push({
      id: `tc_${Date.now()}_7`,
      name: 'calendar_check_availability',
      parameters: {}
    });
  } else if (lower.includes('workflows') || lower.includes('automations') || lower.includes('list flows')) {
    toolCalls.push({
      id: `tc_${Date.now()}_8`,
      name: 'workflows_list',
      parameters: {}
    });
  } else if (lower.includes('campaign') || lower.includes('email marketing') || lower.includes('sms blast')) {
    toolCalls.push({
      id: `tc_${Date.now()}_9`,
      name: 'marketing_summarize_campaigns',
      parameters: {}
    });
  }

  let text = '';
  if (toolCalls.length === 0) {
    text = `Operza Copilot is ready. I can analyze CRM contacts, inspect pipeline revenue, schedule calendar appointments, audit campaigns, or trigger automation workflows. Configure an OpenAI, Anthropic, or Gemini API key in Settings > Integrations for complete multimodal generative reasoning.`;
  }

  if (stream && onToken && text) {
    onToken(text);
  }

  return {
    content: text,
    toolCalls,
    provider: 'local_deterministic',
    model: 'operza-local-engine',
    promptTokens: Math.ceil(lastUserMsg.length / 4),
    completionTokens: Math.ceil(text.length / 4)
  };
}
