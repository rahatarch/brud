import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseBlocks, parseOperations } from '../core/parser';
import { findMatches, reconstructContent } from '../core/engine';
import { executeFileOperations } from '../core/fileOperationEngine';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { PatchBlock, MatchResult } from '../types/patch';

export class BrudSRViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _previewProvider: BrudCodePreviewProvider,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async data => {
      switch (data.command) {
        case 'applyPatch':
          await this._handleApplyPatch(data.text);
          break;
        case 'previewPatch':
          await this._handlePreviewPatch(data.text);
          break;
      }
    });
  }

  private async _handlePreviewPatch(text: string) {
    const filePathMatch = text.match(/^File Path: (.*)/m);
    let document: vscode.TextDocument;

    if (filePathMatch) {
      const filePath = filePathMatch[1].trim();
      try {
        const uri = vscode.Uri.file(filePath);
        document = await vscode.workspace.openTextDocument(uri);
      } catch (e) {
        this._view?.webview.postMessage({
          command: 'error',
          message: `Could not open file: ${filePath}`,
        });
        return;
      }
    } else {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        this._view?.webview.postMessage({
          command: 'error',
          message: 'No active editor found.',
        });
        return;
      }
      document = editor.document;
    }

    const blocks = parseBlocks(text);
    if (blocks.length === 0) {
      this._view?.webview.postMessage({
        command: 'error',
        message: 'No valid blocks found.',
      });
      return;
    }

    const docLines: string[] = [];
    for (let i = 0; i < document.lineCount; i++) {
      docLines.push(document.lineAt(i).text);
    }

    const matches = findMatches(docLines, blocks, (msg, block) => {
      this._view?.webview.postMessage({ command: 'error', message: msg });
      if (block) {
        this._outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
        this._outputChannel.appendLine(`SEARCH_CONTENT: ${JSON.stringify(block.search)}`);
        this._outputChannel.show(true);
      }
    });

    if (!matches) {
      return;
    }

    const previewContent = reconstructContent(docLines, matches);
    const previewUri = document.uri.with({ scheme: 'brud-preview' });
    this._previewProvider.setContent(previewUri, previewContent);

    const virtualDoc = await vscode.workspace.openTextDocument(previewUri);
    if (virtualDoc.languageId !== document.languageId) {
      await vscode.languages.setTextDocumentLanguage(
        virtualDoc,
        document.languageId,
      );
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      previewUri,
      `Brud Preview: ${document.fileName} (PATCHED)`,
    );
  }

  private async _handleApplyPatch(text: string) {
    await this._closePreviewTabs();

    let operations;
    try {
      operations = parseOperations(text);
    } catch (e) {
      this._sendErrorToWebview(e instanceof Error ? e.message : String(e));
      return;
    }

    const result = await executeFileOperations(operations);

    this._outputChannel.appendLine(result.message);
    for (const err of result.errors) {
      this._outputChannel.appendLine(`  ERROR: ${err}`);
    }

    if (result.success && result.errors.length === 0) {
      this._view?.webview.postMessage({ command: 'success', message: result.message });
    } else if (result.success && result.errors.length > 0) {
      this._view?.webview.postMessage({ command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') });
    } else {
      this._view?.webview.postMessage({ command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') });
    }
  }

  private _sendErrorToWebview(errorMessage: string): void {
    if (this._view) {
      this._view.webview.postMessage({ command: 'error', message: errorMessage });
    }
    this._outputChannel.appendLine('ERROR: ' + errorMessage);
  }

  private async _closePreviewTabs() {
    const tabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
    for (const tab of tabs) {
      if (tab.input instanceof vscode.TabInputTextDiff) {
        if (tab.input.modified.scheme === 'brud-preview') {
          await vscode.window.tabGroups.close(tab);
        }
      }
    }
    await new Promise(resolve => (globalThis as any).setTimeout(resolve, 100));
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.html');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'bridge.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'styles.css'));

    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    html = html.replace('{{styleUri}}', styleUri.toString());
    html = html.replace('{{scriptUri}}', scriptUri.toString());

    return html;
  }
}
