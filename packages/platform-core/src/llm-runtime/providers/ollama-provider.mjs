/**
 * ============================================================================
 * Operza Ollama Local LLM Provider
 * ============================================================================
 * 
 * Connects to a local Ollama instance (default: http://localhost:11434).
 * Supports local models like llama3, mistral, qwen2.5, phi3, etc.
 */

export class OllamaProvider {
  constructor(options = {}) {
    this.id = 'ollama';
    this.name = 'Ollama Local Daemon';
    this.baseUrl = (options.baseUrl || process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
    this.modelName = options.model || process.env.OLLAMA_MODEL || 'smollm:135m';
    this.fetchFn = options.fetchFn || globalThis.fetch;
  }

  async isAvailable() {
    try {
      const res = await this.fetchFn(`${this.baseUrl}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (!res.ok) return false;
      const data = await res.json().catch(() => ({}));
      const models = data.models || [];
      return Array.isArray(models) && models.length > 0;
    } catch {
      return false;
    }
  }

  async complete(messages, options = {}) {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const body = {
      model: options.model || this.modelName,
      messages: formattedMessages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens || 128
      }
    };

    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Ollama error HTTP ${res.status}: ${await res.text()}`);
    }

    const data = await res.json();
    return {
      text: data.message?.content || '',
      toolCalls: [],
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0)
      }
    };
  }

  async *stream(messages, options = {}) {
    const formattedMessages = messages.map(m => ({
      role: m.role,
      content: m.content
    }));

    const body = {
      model: options.model || this.modelName,
      messages: formattedMessages,
      stream: true,
      options: {
        temperature: options.temperature ?? 0.7,
        num_predict: options.maxTokens || 128
      }
    };

    const res = await this.fetchFn(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      throw new Error(`Ollama streaming error HTTP ${res.status}`);
    }

    if (!res.body || typeof res.body.getReader !== 'function') {
      // Fallback if reader not supported
      const data = await res.json();
      yield { type: 'token', token: data.message?.content || '' };
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
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.message?.content) {
            yield { type: 'token', token: parsed.message.content };
          }
          if (parsed.done) {
            yield { type: 'done', finishReason: 'stop' };
          }
        } catch {
          // ignore malformed line
        }
      }
    }
  }
}
