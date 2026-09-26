import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OpenAICompatibleProvider } from '@brud/automation';
import type { AiChunkMessage, AiDoneMessage, AiErrorMessage } from '@brud/protocol';

export class StreamTestPanelProvider {
  private _panel: vscode.WebviewPanel | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public open() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'brud-stream-test',
      'Brud Stream Test',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'apps', 'vscode', 'src', 'webviews'),
        ],
      },
    );

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    try {
      this._panel.webview.html = this._getHtmlForWebview();
    } catch (e) {
      this._panel = undefined;
      console.error(`[StreamTestPanelProvider] open() failed: ${e}`);
      throw e;
    }

    this._panel.webview.onDidReceiveMessage((data: any) => {
      if (data.command === 'aiChat' && typeof data.text === 'string') {
        this._handleAiChat(data.text);
      }
    });
  }

  private _getHtmlForWebview(): string {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'apps', 'vscode', 'src', 'webviews', 'stream-test.html');
    try {
      const html = fs.readFileSync(htmlPath.fsPath, 'utf8');
      console.log(`[StreamTestPanelProvider] Panel opened, HTML loaded from ${htmlPath.fsPath}`);
      return html;
    } catch (e) {
      console.error(`[StreamTestPanelProvider] Failed to read HTML from ${htmlPath.fsPath}: ${e}`);
      return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Stream Test — Error</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 2rem; color: #ccc; background: #1e1e1e; }
    h1 { color: #f48771; }
    p { margin: 0.5rem 0; }
    .path { font-family: monospace; background: #2d2d2d; padding: 0.2rem 0.4rem; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Stream Test — Failed to load HTML</h1>
  <p>Attempted path: <span class="path">${htmlPath.fsPath}</span></p>
  <p>Error: ${e instanceof Error ? e.message : String(e)}</p>
  <p>The panel is still functional. Close and reopen to retry.</p>
</body>
</html>`;
    }
  }

  private async _handleAiChat(text: string): Promise<void> {
    const webview = this._panel?.webview;
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
      }
    } catch (e) {
      console.warn('StreamTestPanel: failed to load autonomous-system prompt', e);
    }

    const messages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: text });

    let fullReasoning = '';
    try {
      const fullText = await provider.chatStream!(
        messages,
        (chunk) => {
          const msg: AiChunkMessage = { command: 'aiChunk', chunk };
          webview.postMessage(msg);
        },
        (reasoningChunk) => {
          fullReasoning += reasoningChunk;
          webview.postMessage({ command: 'aiReasoningChunk', reasoningChunk });
        },
      );
      const doneMsg: AiDoneMessage = { command: 'aiDone', fullText };
      webview.postMessage(doneMsg);
      if (fullReasoning) {
        webview.postMessage({ command: 'aiReasoningDone', fullReasoning });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const errorMsg: AiErrorMessage = { command: 'aiError', message: errMsg };
      webview.postMessage(errorMsg);
    }
  }
}