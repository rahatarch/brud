import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseOperations } from '../core/parser';
import { findMatches, reconstructContent } from '../core/engine';
import { executeFileOperations } from '../core/fileOperationEngine';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { validateWorkspacePath } from '../utils/workspacePath';
import { PatchBlock, FileOperation } from '../types/patch';

export class BrudSRViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _operationsByFile: Map<string, FileOperation[]> = new Map();
  private _fileList: string[] = [];
  private _currentFileIndex: number = 0;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _previewProvider: BrudCodePreviewProvider,
  ) {}

  private _groupOperationsByFile(operations: FileOperation[]): Map<string, FileOperation[]> {
    const grouped = new Map<string, FileOperation[]>();
    for (const op of operations) {
      const key = op.kind === 'rename_file' || op.kind === 'move_file' || op.kind === 'copy_file'
        ? op.from
        : op.path;
      const existing = grouped.get(key) || [];
      existing.push(op);
      grouped.set(key, existing);
    }
    return grouped;
  }

  private async _showPreviewForFile(filePath: string) {
    const result = validateWorkspacePath(filePath);
    if (!result.valid) {
      this._sendErrorToWebview(result.error);
      return;
    }

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(result.uri);
    } catch (e) {
      this._view?.webview.postMessage({
        command: 'error',
        message: `Could not open file: ${filePath}`,
      });
      return;
    }

    const operations = this._operationsByFile.get(filePath) || [];
    const searchReplaceOps = operations.filter(op => op.kind === 'search_replace');

    if (searchReplaceOps.length === 0) {
      this._view?.webview.postMessage({
        command: 'error',
        message: 'No preview available for this file.',
      });
      return;
    }

    const blocks: PatchBlock[] = searchReplaceOps.map(op => ({
      index: op.index,
      search: op.search,
      searchMeat: op.search.replace(/\s+/g, ''),
      replace: op.replace,
    }));

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
      await vscode.languages.setTextDocumentLanguage(virtualDoc, document.languageId);
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      document.uri,
      previewUri,
      `Brud Preview: ${document.fileName} (PATCHED)`,
    );

    this._view?.webview.postMessage({
      command: 'updatePreviewHeader',
      fileName: filePath,
      fileIndex: this._currentFileIndex,
      totalFiles: this._fileList.length,
    });
  }

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
        case 'previewNextFile':
          await this._handlePreviewNextFile();
          break;
        case 'previewPrevFile':
          await this._handlePreviewPrevFile();
          break;
        case 'previewAllFiles':
          await this._handlePreviewAllFiles();
          break;
        case 'executeCurrentFile':
          await this._handleExecuteCurrentFile();
          break;
        case 'executeAllFiles':
          await this._handleExecuteAllFiles();
          break;
      }
    });
  }

  private async _handlePreviewPatch(text: string) {
    let operations;
    try {
      operations = parseOperations(text);
    } catch (e) {
      this._sendErrorToWebview(e instanceof Error ? e.message : String(e));
      return;
    }

    this._operationsByFile = this._groupOperationsByFile(operations);
    this._fileList = Array.from(this._operationsByFile.keys());
    this._currentFileIndex = 0;

    if (this._fileList.length === 0) {
      this._sendErrorToWebview('No valid operations found.');
      return;
    }

    await this._showPreviewForFile(this._fileList[0]);
    this._view?.webview.postMessage({ command: 'showPreviewNavigation' });
  }

  private async _handlePreviewNextFile() {
    if (this._fileList.length === 0) {
      return;
    }
    this._currentFileIndex++;
    if (this._currentFileIndex >= this._fileList.length) {
      this._currentFileIndex = 0;
    }
    await this._showPreviewForFile(this._fileList[this._currentFileIndex]);
  }

  private async _handlePreviewPrevFile() {
    if (this._fileList.length === 0) {
      return;
    }
    this._currentFileIndex--;
    if (this._currentFileIndex < 0) {
      this._currentFileIndex = this._fileList.length - 1;
    }
    await this._showPreviewForFile(this._fileList[this._currentFileIndex]);
  }

  private async _handlePreviewAllFiles() {
    if (this._fileList.length === 0) {
      return;
    }

    const combinedParts: string[] = [];

    for (const filePath of this._fileList) {
      const result = validateWorkspacePath(filePath);
      if (!result.valid) {
        continue;
      }

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(result.uri);
      } catch {
        continue;
      }

      const operations = this._operationsByFile.get(filePath) || [];
      const searchReplaceOps = operations.filter(op => op.kind === 'search_replace');
      if (searchReplaceOps.length === 0) {
        continue;
      }

      const blocks: PatchBlock[] = searchReplaceOps.map(op => ({
        index: op.index,
        search: op.search,
        searchMeat: op.search.replace(/\s+/g, ''),
        replace: op.replace,
      }));

      const docLines: string[] = [];
      for (let i = 0; i < document.lineCount; i++) {
        docLines.push(document.lineAt(i).text);
      }

      const matches = findMatches(docLines, blocks, (msg, block) => {
        this._outputChannel.appendLine(`WARNING: ${msg}`);
        if (block) {
          this._outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
        }
      });

      if (!matches) {
        continue;
      }

      const previewContent = reconstructContent(docLines, matches);
      combinedParts.push(`// === ${filePath} ===\n${previewContent}`);
    }

    if (combinedParts.length === 0) {
      this._sendErrorToWebview('No preview could be generated for any file.');
      return;
    }

    const combinedContent = combinedParts.join('\n\n');
    const firstFileResult = validateWorkspacePath(this._fileList[0]);
    if (!firstFileResult.valid) {
      return;
    }

    let firstDocument: vscode.TextDocument;
    try {
      firstDocument = await vscode.workspace.openTextDocument(firstFileResult.uri);
    } catch {
      return;
    }

    const previewUri = vscode.Uri.parse('brud-preview://all-files');
    this._previewProvider.setContent(previewUri, combinedContent);

    const virtualDoc = await vscode.workspace.openTextDocument(previewUri);
    if (virtualDoc.languageId !== firstDocument.languageId) {
      await vscode.languages.setTextDocumentLanguage(virtualDoc, firstDocument.languageId);
    }

    await vscode.commands.executeCommand(
      'vscode.diff',
      firstDocument.uri,
      previewUri,
      'Brud Preview: All Files (PATCHED)',
    );

    this._view?.webview.postMessage({
      command: 'updatePreviewHeader',
      fileName: 'All Files',
      fileIndex: -1,
      totalFiles: this._fileList.length,
    });
  }

  private async _handleExecuteCurrentFile() {
    if (this._fileList.length === 0 || this._currentFileIndex < 0 || this._currentFileIndex >= this._fileList.length) {
      return;
    }

    const filePath = this._fileList[this._currentFileIndex];
    const operations = this._operationsByFile.get(filePath) || [];
    const result = await executeFileOperations(operations);
    this._reportExecutionResult(result);
  }

  private async _handleExecuteAllFiles() {
    if (this._operationsByFile.size === 0) {
      return;
    }

    const allOperations: FileOperation[] = [];
    for (const ops of this._operationsByFile.values()) {
      allOperations.push(...ops);
    }

    const result = await executeFileOperations(allOperations);
    this._reportExecutionResult(result);
  }

  private _reportExecutionResult(result: { success: boolean; message: string; errors: string[] }) {
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
    this._reportExecutionResult(result);
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
