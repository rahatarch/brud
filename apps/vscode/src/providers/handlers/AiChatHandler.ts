import * as vscode from 'vscode';
import { OpenAICompatibleProvider } from '@brud/automation';
import type { AiChunkMessage, AiDoneMessage, AiErrorMessage } from '@brud/protocol';

export class AiChatHandler {
  constructor(
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  async handle(text: string): Promise<void> {
    const webview = this.getWebview();
    if (!webview) return;

    const baseUrl = process.env.BRUD_AI_BASE_URL;
    const apiKey = process.env.BRUD_AI_API_KEY;
    const model = process.env.BRUD_AI_MODEL;

    if (!baseUrl || !apiKey || !model) {
      const missing: string[] = [];
      if (!baseUrl) missing.push('BRUD_AI_BASE_URL');
      if (!apiKey) missing.push('BRUD_AI_API_KEY');
      if (!model) missing.push('BRUD_AI_MODEL');
      const errMsg = `Missing environment variables: ${missing.join(', ')}`;
      const msg: AiErrorMessage = { command: 'aiError', message: errMsg };
      webview.postMessage(msg);
      return;
    }

    const provider = new OpenAICompatibleProvider({ baseUrl, apiKey, model });

    let systemPrompt = '';
    try {
      const { getPromptById } = await import('@brud/core');
      const prompt = getPromptById('autonomous-system');
      if (prompt) {
        systemPrompt = prompt.content;
      } else {
        console.warn('AiChatHandler: autonomous-system prompt not found, using empty string');
      }
    } catch (e) {
      console.warn('AiChatHandler: failed to load autonomous-system prompt', e);
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: text });

    try {
      const fullText = await provider.chatStream!(messages, (chunk) => {
        const msg: AiChunkMessage = { command: 'aiChunk', chunk };
        console.error(`[stream->webview] chunk len ${chunk.length}`);
        webview.postMessage(msg);
      });
      const doneMsg: AiDoneMessage = { command: 'aiDone', fullText };
      webview.postMessage(doneMsg);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorMsg: AiErrorMessage = { command: 'aiError', message: errMsg };
      webview.postMessage(errorMsg);
    }
  }
}