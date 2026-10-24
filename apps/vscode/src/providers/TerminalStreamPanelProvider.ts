import * as vscode from 'vscode';
import * as fs from 'fs';
import type { ExtensionMessage } from '@brud/protocol';

export class BrudTerminalPanelManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _pendingQueue: ExtensionMessage[] = [];
  private _isReady = false;
  private _closeAfterFlush = false;
  private _closeTimer: NodeJS.Timeout | null = null;
  private _currentRunId: string | undefined = undefined;
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

  public postMessage(message: ExtensionMessage): void {
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

  public openTerminalStreamPanel(runId?: string) {
    const previousRunId = this._currentRunId;
    this._currentRunId = runId;

    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    this._closeAfterFlush = false;

    if (this._panel) {
      if (!this._isReady && runId !== previousRunId) {
        this._pendingQueue = [];
      }
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

    this._pendingQueue = [];
    this._isReady = false;

    this._panel = vscode.window.createWebviewPanel(
      'brud-terminal-stream',
      'Brud Terminal Stream',
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
      this._resetState();
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready') {
        if (!this._isReady) {
          this._isReady = true;
          const queued = this._pendingQueue;
          this._pendingQueue = [];
          for (const pending of queued) {
            this._panel?.webview.postMessage(pending);
          }
          if (this._closeAfterFlush) {
            this._closeAfterFlush = false;
            this._scheduleDispose(400);
          }
        }
        return;
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

  public closePanel(runId?: string) {
    if (runId && this._currentRunId && runId !== this._currentRunId) {
      return;
    }

    if (!this._panel) {
      this._resetState();
      return;
    }

    if (!this._isReady) {
      this._closeAfterFlush = true;
      if (!this._closeTimer) {
        this._scheduleDispose(2000);
      }
      return;
    }

    this._scheduleDispose(400);
  }

  private _scheduleDispose(delayMs: number): void {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
    }
    this._closeTimer = setTimeout(() => {
      this._doDispose();
    }, delayMs);
  }

  private _resetState(): void {
    if (this._closeTimer) {
      clearTimeout(this._closeTimer);
      this._closeTimer = null;
    }
    this._isReady = false;
    this._closeAfterFlush = false;
    this._pendingQueue = [];
    this._currentRunId = undefined;
  }

  private _doDispose(): void {
    const panel = this._panel;
    this._resetState();
    this._panel = undefined;
    panel?.dispose();
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
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="terminal-stream" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}