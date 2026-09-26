export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIProvider {
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  chatStream?(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onReasoningChunk?: (chunk: string) => void,
    options?: ChatOptions
  ): Promise<string>;
}