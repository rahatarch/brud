import * as vscode from 'vscode';
import * as fs from 'fs';
import { WorkspaceHistoryStore, getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { WebviewMessage, ExtensionMessage, HistorySessionResult, RevertHistoryData } from '@brud/protocol';
import { revertOperations } from '@brud/core';

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
        case 'getRevertHistory':
          await this._handleGetRevertHistory(data.sessionId);
          break;
        case 'revertSession':
          await this._handleRevertSession(data.sessionId, data.targetState);
          break;
        case 'revertOperations':
          await this._handleRevertOperations(data.sessionId, data.operationIds, data.targetState);
          break;
        case 'deleteSingleSession':
          await this._handleDeleteSingleSession(data.sessionId, data.triggeredBy);
          break;
        case 'wipeHistory':
          await this._handleWipeHistory();
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

  private async _handleGetRevertHistory(sessionId?: string): Promise<void> {
    if (!this._historyStore || !sessionId) {
      this._panel?.webview.postMessage({ command: 'revertHistoryResult', revertHistory: [] } satisfies ExtensionMessage);
      return;
    }

    const result = await this._historyStore.getRevertHistory(sessionId);
    const revertHistory: RevertHistoryData[] = result.reverts.map(r => ({
      revertId: r.revertId,
      timestamp: r.timestamp,
      targetState: r.targetState,
      revertedOperationIds: r.revertedOperationIds,
      status: r.status,
      errorMessage: r.errorMessage,
    }));

    this._panel?.webview.postMessage({ command: 'revertHistoryResult', revertHistory } satisfies ExtensionMessage);
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

  private async _handleRevertOperations(sessionId?: string, operationIds?: string[], targetState?: 'pre' | 'post'): Promise<void> {
    if (!this._historyStore || !sessionId || !operationIds || !targetState) {
      this._panel?.webview.postMessage({
        command: 'revertOperationsResult',
        revertOperationsResult: { success: false, message: 'Missing sessionId, operationIds, or targetState', errors: ['Invalid revert request'] },
      } satisfies ExtensionMessage);
      return;
    }

    const result = await revertOperations(
      sessionId,
      operationIds,
      targetState,
      this._historyStore,
      this._historyStore['fileSystem'],
      getWorkspaceFolders(),
      (revertEntry) => {
        this._historyStore!.saveRevertHistory(sessionId, revertEntry).catch(() => {});
      },
    );
    this._panel?.webview.postMessage({ command: 'revertOperationsResult', revertOperationsResult: result } satisfies ExtensionMessage);
  }

  private async _handleDeleteSingleSession(sessionId?: string, triggeredBy?: 'user' | 'system'): Promise<void> {
    if (!this._historyStore || !sessionId || !triggeredBy) {
      this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount: 0 } satisfies ExtensionMessage);
      return;
    }

    const deletedCount = await this._historyStore.deleteSingleSession(sessionId, triggeredBy);
    this._panel?.webview.postMessage({ command: 'sessionDeleted', deletedCount } satisfies ExtensionMessage);
  }

  private async _handleWipeHistory(): Promise<void> {
    if (!this._historyStore) {
      this._panel?.webview.postMessage({ command: 'historyWiped', deletedCount: 0, history: [] } satisfies ExtensionMessage);
      return;
    }

    const deletedCount = await this._historyStore.wipeAllHistory();
    this._panel?.webview.postMessage({ command: 'historyWiped', deletedCount, history: [] } satisfies ExtensionMessage);
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