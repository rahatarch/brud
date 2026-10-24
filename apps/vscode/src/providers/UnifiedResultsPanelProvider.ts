import * as vscode from 'vscode';
import * as fs from 'fs';

export class BrudUnifiedResultsPanelManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _pendingQueue: any[] = [];
  private _isReady: boolean = false;
  private readonly MAX_QUEUE_COUNT = 2000;
  private _onKillProcess: ((processId: string) => void) | null = null;
  private _getActiveProcessIds: (() => string[]) | null = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public setKillProcessHandler(handler: (processId: string) => void): void {
    this._onKillProcess = handler;
  }

  public setActiveProcessIdsGetter(getter: () => string[]): void {
    this._getActiveProcessIds = getter;
  }

  public postMessage(message: any): void {
    if (!this._panel) {
      return;
    }

    if (this._isReady) {
      this._panel.webview.postMessage(message);
      return;
    }

    if (this._pendingQueue.length >= this.MAX_QUEUE_COUNT) {
      const dropIndex = this._pendingQueue.findIndex((queued) => !queued.streamDone);
      if (dropIndex >= 0) {
        this._pendingQueue.splice(dropIndex, 1);
      } else {
        this._pendingQueue.shift();
      }
    }

    this._pendingQueue.push(message);
  }

  public postChunk(chunk: string, chunkIndex: number, processId: string): void {
    this.postMessage({
      command: 'terminalChunk',
      chunk,
      chunkIndex,
      processId,
    });
  }

  public postStreamDone(processId: string, status: 'success' | 'failed' | 'interrupted'): void {
    this.postMessage({
      command: 'terminalChunk',
      chunk: '',
      chunkIndex: -1,
      processId,
      streamDone: true,
      streamStatus: status,
    });
  }

  public openUnifiedResultsPanel(results: Record<string, any>) {
    const message = { command: 'unifiedResults', results };

    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      this.postMessage(message);
      return;
    }

    this._isReady = false;
    this._pendingQueue = [message];

    this._panel = vscode.window.createWebviewPanel(
      'brud-unified-results-panel',
      'Brud Session Results',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => {
      this._isReady = false;
      this._pendingQueue = [];
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready') {
        this._isReady = true;
        const queued = [...this._pendingQueue];
        this._pendingQueue = [];
        for (const msg of queued) {
          this._panel?.webview.postMessage(msg);
        }
      }
      if (message.command === 'killProcess' && message.processId && this._onKillProcess) {
        this._onKillProcess(message.processId);
      }
      if (message.command === 'getActiveProcessIds' && this._getActiveProcessIds) {
        const ids = this._getActiveProcessIds();
        this._panel?.webview.postMessage({ command: 'activeProcessIds', processIds: ids });
      }
    });
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
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'icons', 'brud_icon_rounded_white.svg')
    );
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="unified-results" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}