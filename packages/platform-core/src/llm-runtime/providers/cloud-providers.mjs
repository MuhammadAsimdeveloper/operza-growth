/**
 * ============================================================================
 * Operza Commercial Cloud LLM Adapters (OpenAI / Anthropic / Gemini)
 * ============================================================================
 * 
 * Provides pluggable adapters for commercial cloud APIs when API keys are supplied.
 */

export class OpenAIProvider {
  constructor(options = {}) {
    this.id = 'openai';
    this.name = 'OpenAI (GPT-4o)';
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
    this.modelName = options.model || process.env.OPENAI_MODEL || 'gpt-4o';
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  async isAvailable() {
    return Boolean(this.apiKey && this.apiKey.startsWith('sk-'));
  }

  async complete(messages, options = {}) {
    const res = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || this.modelName,
        messages,
        temperature: options.temperature ?? 0.7,
        tools: options.tools
      })
    });
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      toolCalls: data.choices?.[0]?.message?.tool_calls || [],
      usage: data.usage || {}
    };
  }

  async *stream(messages, options = {}) {
    const res = await this.fetchFn('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || this.modelName,
        messages,
        temperature: options.temperature ?? 0.7,
        stream: true
      })
    });
    if (!res.ok) throw new Error(`OpenAI stream HTTP ${res.status}`);

    const reader = res.body?.getReader?.();
    if (!reader) {
      const data = await res.json();
      yield { type: 'token', token: data.choices?.[0]?.message?.content || '' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }
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
        if (trimmed === 'data: [DONE]') {
          yield { type: 'done', finishReason: 'stop' };
          continue;
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const token = parsed.choices?.[0]?.delta?.content;
            if (token) yield { type: 'token', token };
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
