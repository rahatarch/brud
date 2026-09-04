import * as vscode from 'vscode';
import * as fs from 'fs';
import { WorkspaceHistoryStore, getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { WebviewMessage, ExtensionMessage, HistorySessionResult } from '@brud/protocol';

export class BrudMainWindowManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _historyStore: WorkspaceHistoryStore | undefined;

  constructor(private readonly _extensionUri: vscode.Uri) {
    const folders = getWorkspaceFolders();
    if (folders.length > 0) {
      this._historyStore = new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem());
    }
  }

  public postMessage(message: any): void {
    if (this._panel) {
      this._panel.webview.postMessage(message);
    }
  }

  public openMainWindow() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._panel = vscode.window.createWebviewPanel(
      'brud-main-window',
      'Brud Code Management',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
          vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview'),
        ],
      },
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      switch (data.command) {
        case 'getHistory':
          await this._handleGetHistory();
          break;
        case 'revertSession':
          await this._handleRevertSession(data.sessionId, data.targetState);
          break;
      }
    });
  }

  private async _handleGetHistory(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'historyResult', history: [] } satisfies ExtensionMessage);
      return;
    }

    const sessions = await this._historyStore.getAllSessions();
    const history: HistorySessionResult[] = sessions.map(s => ({
      sessionId: s.sessionId,
      timestamp: s.timestamp,
      originalPrompt: s.originalPrompt,
      status: s.status,
      operationCount: s.operationCount,
      operationTypes: s.operationTypes,
      operations: s.operations,
      filesAffected: s.filesAffected,
      metadataUsed: s.metadataUsed,
      terminalCommands: s.terminalCommands,
      revertCommands: s.revertCommands,
    }));

    this._panel?.webview.postMessage({ command: 'historyResult', history } satisfies ExtensionMessage);
  }

  private async _handleRevertSession(sessionId?: string, targetState?: 'pre' | 'post'): Promise<void> {
    if (!this._historyStore || !sessionId || !targetState) {
      this._panel?.webview.postMessage({
        command: 'revertResult',
        revertResult: { success: false, message: 'Missing sessionId or targetState', errors: ['Invalid revert request'] },
      } satisfies ExtensionMessage);
      return;
    }

    const result = await this._historyStore.revertSession(sessionId, targetState);
    this._panel?.webview.postMessage({ command: 'revertResult', revertResult: result } satisfies ExtensionMessage);
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'index.html');
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');

    html = html.replace(/<link[^>]*fonts\.googleapis\.com[^>]*>/g, '');
    html = html.replace(/<link[^>]*fonts\.gstatic\.com[^>]*>/g, '');

    const assetRegex = /(?:src|href)="(\.\/(?:assets|images)\/[^"]+)"/g;
    html = html.replace(assetRegex, (match, assetPath) => {
      const assetUri = vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', assetPath.replace('./', ''));
      const webviewUri = webview.asWebviewUri(assetUri);
      return match.replace(assetPath, webviewUri.toString());
    });

    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'images', 'brud_compressed_high.png')
    );
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="main-window" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}