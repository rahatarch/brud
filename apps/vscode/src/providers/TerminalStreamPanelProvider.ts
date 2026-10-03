import * as vscode from 'vscode';
import * as fs from 'fs';

export class BrudTerminalPanelManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _pendingMessage: any = null;
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
    if (this._panel) {
      this._panel.webview.postMessage(message);
    } else {
      this._pendingMessage = message;
    }
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

  public openTerminalStreamPanel() {
    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      return;
    }

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
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready') {
        if (this._pendingMessage) {
          this._panel?.webview.postMessage(this._pendingMessage);
          this._pendingMessage = null;
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

  public closePanel() {
    if (this._panel) {
      this._panel.dispose();
      this._panel = undefined;
    }
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