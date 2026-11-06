/**
 * ============================================================================
 * Operza LocalAI / vLLM OpenAI-Compatible LLM Provider
 * ============================================================================
 * 
 * Connects to LocalAI, vLLM, LM Studio, or any OpenAI-compatible local server.
 */

export class LocalAIProvider {
  constructor(options = {}) {
    this.id = 'localai';
    this.name = 'LocalAI / vLLM Endpoint';
    this.baseUrl = (options.baseUrl || process.env.LOCALAI_HOST || 'http://localhost:8080/v1').replace(/\/$/, '');
    this.modelName = options.model || process.env.LOCALAI_MODEL || 'gpt-4';
    this.apiKey = options.apiKey || process.env.LOCALAI_API_KEY || 'not-needed';
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  async isAvailable() {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(1500)
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async complete(messages, options = {}) {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model || this.modelName,
        messages,
        temperature: options.temperature ?? 0.7,
        stream: false
      })
    });

    if (!res.ok) {
      throw new Error(`LocalAI HTTP error ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      text: data.choices?.[0]?.message?.content || '',
      toolCalls: data.choices?.[0]?.message?.tool_calls || [],
      usage: data.usage || {}
    };
  }

  async *stream(messages, options = {}) {
    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
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

    if (!res.ok) {
      throw new Error(`LocalAI streaming HTTP error ${res.status}`);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      const data = await res.json();
      yield { type: 'token', token: data.choices?.[0]?.message?.content || '' };
      yield { type: 'done', finishReason: 'stop' };
      return;
    }

    const reader = res.body.getReader();
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
        if (!trimmed || trimmed === 'data: [DONE]') {
          if (trimmed === 'data: [DONE]') yield { type: 'done', finishReason: 'stop' };
          continue;
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              yield { type: 'token', token: delta };
            }
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
