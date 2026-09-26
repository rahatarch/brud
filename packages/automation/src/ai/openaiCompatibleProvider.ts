import type { AIProvider, ChatMessage, ChatOptions } from './provider.js';

export class OpenAICompatibleProvider implements AIProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(config: { baseUrl: string; apiKey: string; model: string }) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: options?.model ?? this.model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      temperature: options?.temperature,
      max_tokens: options?.maxTokens,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      throw new Error(`OpenAI API returned unexpected response shape: ${JSON.stringify(data)}`);
    }

    return content;
  }

  async chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onReasoningChunk?: (chunk: string) => void,
    options?: ChatOptions,
  ): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify({
      model: options?.model ?? this.model,
      messages: messages.map(({ role, content }) => ({ role, content })),
      stream: true,
      max_tokens: options?.maxTokens ?? 4096,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorBody}`);
    }

    if (!response.body) {
      throw new Error('Response body is null — streaming not supported');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let fullReasoning = '';
    let chunkIndex = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') {
          reader.cancel();
          return fullText;
        }

        try {
          const parsed = JSON.parse(data);
          const choice = parsed?.choices?.[0]?.delta;
          const delta = choice?.content;
          const reasoningDelta = choice?.reasoning_content;
          if (typeof delta === 'string' && delta.length > 0) {
            fullText += delta;
            console.error(`[stream] chunk ${chunkIndex++} len ${delta.length}`);
            onChunk(delta);
          }
          if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
            fullReasoning += reasoningDelta;
            onReasoningChunk?.(reasoningDelta);
          }
        } catch {
          // skip partial JSON lines at chunk boundaries
        }
      }
    }

    return fullText;
  }
}