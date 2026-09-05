import * as vscode from 'vscode';
import * as fs from 'fs';

export class BrudUnifiedResultsPanelManager {
  private _panel: vscode.WebviewPanel | undefined;
  private _pendingMessage: any = null;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public postMessage(message: any): void {
    if (this._panel) {
      this._panel.webview.postMessage(message);
    } else {
      this._pendingMessage = message;
    }
  }

  public openUnifiedResultsPanel(results: Record<string, any>) {
    const message = { command: 'unifiedResults', results };

    if (this._panel) {
      this._panel.reveal(vscode.ViewColumn.One);
      this._panel.webview.postMessage(message);
      return;
    }

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

    this._pendingMessage = message;

    this._panel.onDidDispose(() => {
      this._panel = undefined;
    });

    this._panel.webview.onDidReceiveMessage((message) => {
      if (message.command === 'ready' && this._pendingMessage) {
        this._panel?.webview.postMessage(this._pendingMessage);
        this._pendingMessage = null;
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
      vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview', 'images', 'brud_compressed_high.png')
    );
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="unified-results" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}