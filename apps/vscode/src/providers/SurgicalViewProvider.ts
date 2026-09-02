import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseOperations } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { validateWorkspacePath } from '@brud/core';
import { PatchBlock, FileOperation } from '@brud/core';
import type { WebviewMessage, ExtensionMessage, ExecutionResult } from '@brud/protocol';

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

    const operations = this._operationsByFile.get(filePath) || [];
    const searchReplaceOps = operations.filter(op => op.kind === 'search_replace');
    const createFileOps = operations.filter(op => op.kind === 'create_file');
    const appendFileOps = operations.filter(op => op.kind === 'append_file');

    if (searchReplaceOps.length === 0 && createFileOps.length > 0) {
      const fileExtension = filePath.split('.').pop() || '';
      const languageMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescriptreact',
        js: 'javascript',
        jsx: 'javascriptreact',
        json: 'json',
        css: 'css',
        html: 'html',
        md: 'markdown',
        py: 'python',
        rs: 'rust',
        go: 'go',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        h: 'c',
        hpp: 'cpp',
        yaml: 'yaml',
        yml: 'yaml',
        xml: 'xml',
        sh: 'shellscript',
        bash: 'shellscript',
        sql: 'sql',
        vue: 'vue',
        svelte: 'svelte',
        scss: 'scss',
        less: 'less',
      };
      const languageId = languageMap[fileExtension] || 'plaintext';

      const emptyUri = vscode.Uri.parse('brud-preview://empty-' + Date.now() + '.' + fileExtension);
      this._previewProvider.setContent(emptyUri, '');

      const previewUri = vscode.Uri.parse('brud-preview://preview-' + Date.now() + '.' + fileExtension);
      this._previewProvider.setContent(previewUri, createFileOps[0].content);

      const emptyDoc = await vscode.workspace.openTextDocument(emptyUri);
      if (emptyDoc.languageId !== languageId) {
        await vscode.languages.setTextDocumentLanguage(emptyDoc, languageId);
      }

      const previewDoc = await vscode.workspace.openTextDocument(previewUri);
      if (previewDoc.languageId !== languageId) {
        await vscode.languages.setTextDocumentLanguage(previewDoc, languageId);
      }

      await vscode.commands.executeCommand('vscode.diff', emptyUri, previewUri, 'Brud Preview: ' + filePath + ' (NEW FILE)');

      const msg: ExtensionMessage = {
        command: 'updatePreviewHeader',
        fileName: filePath,
        fileIndex: this._currentFileIndex,
        totalFiles: this._fileList.length,
      };
      this._view?.webview.postMessage(msg);
      return;
    }

    if (searchReplaceOps.length === 0 && createFileOps.length === 0 && appendFileOps.length > 0) {
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(result.uri);
      } catch {
        const errMsg: ExtensionMessage = { command: 'error', message: `Could not open file: ${filePath}` };
        this._view?.webview.postMessage(errMsg);
        const headerMsg: ExtensionMessage = {
          command: 'updatePreviewHeader',
          fileName: filePath,
          fileIndex: this._currentFileIndex,
          totalFiles: this._fileList.length,
        };
        this._view?.webview.postMessage(headerMsg);
        return;
      }

      const docLines: string[] = [];
      for (let i = 0; i < document.lineCount; i++) {
        docLines.push(document.lineAt(i).text);
      }
      const originalContent = docLines.join('\n');

      let modifiedContent = originalContent;
      for (const op of appendFileOps) {
        if (op.position === 'end') {
          modifiedContent += op.content;
        } else {
          modifiedContent = op.content + modifiedContent;
        }
      }

      const fileExtension = filePath.split('.').pop() || '';
      const languageMap: Record<string, string> = {
        ts: 'typescript',
        tsx: 'typescriptreact',
        js: 'javascript',
        jsx: 'javascriptreact',
        json: 'json',
        css: 'css',
        html: 'html',
        md: 'markdown',
        py: 'python',
        rs: 'rust',
        go: 'go',
        java: 'java',
        cpp: 'cpp',
        c: 'c',
        h: 'c',
        hpp: 'cpp',
        yaml: 'yaml',
        yml: 'yaml',
        xml: 'xml',
        sh: 'shellscript',
        bash: 'shellscript',
        sql: 'sql',
        vue: 'vue',
        svelte: 'svelte',
        scss: 'scss',
        less: 'less',
      };
      const languageId = languageMap[fileExtension] || 'plaintext';

      const originalUri = vscode.Uri.parse('brud-preview://original-' + Date.now() + '.' + fileExtension);
      this._previewProvider.setContent(originalUri, originalContent);

      const previewUri = vscode.Uri.parse('brud-preview://preview-' + Date.now() + '.' + fileExtension);
      this._previewProvider.setContent(previewUri, modifiedContent);

      const originalDoc = await vscode.workspace.openTextDocument(originalUri);
      if (originalDoc.languageId !== languageId) {
        await vscode.languages.setTextDocumentLanguage(originalDoc, languageId);
      }

      const previewDoc = await vscode.workspace.openTextDocument(previewUri);
      if (previewDoc.languageId !== languageId) {
        await vscode.languages.setTextDocumentLanguage(previewDoc, languageId);
      }

      await vscode.commands.executeCommand('vscode.diff', originalUri, previewUri, 'Brud Preview: ' + filePath + ' (APPENDED)');

      const headerMsg: ExtensionMessage = {
        command: 'updatePreviewHeader',
        fileName: filePath,
        fileIndex: this._currentFileIndex,
        totalFiles: this._fileList.length,
      };
      this._view?.webview.postMessage(headerMsg);
      return;
    }

    if (searchReplaceOps.length > 0) {
      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(result.uri);
      } catch (e) {
        if (createFileOps.length > 0) {
          const fileExtension = filePath.split('.').pop() || '';
          const languageMap: Record<string, string> = {
            ts: 'typescript',
            tsx: 'typescriptreact',
            js: 'javascript',
            jsx: 'javascriptreact',
            json: 'json',
            css: 'css',
            html: 'html',
            md: 'markdown',
            py: 'python',
            rs: 'rust',
            go: 'go',
            java: 'java',
            cpp: 'cpp',
            c: 'c',
            h: 'c',
            hpp: 'cpp',
            yaml: 'yaml',
            yml: 'yaml',
            xml: 'xml',
            sh: 'shellscript',
            bash: 'shellscript',
            sql: 'sql',
            vue: 'vue',
            svelte: 'svelte',
            scss: 'scss',
            less: 'less',
          };
          const languageId = languageMap[fileExtension] || 'plaintext';

          const emptyUri = vscode.Uri.parse('brud-preview://empty-' + Date.now() + '.' + fileExtension);
          this._previewProvider.setContent(emptyUri, '');

          const previewUri = vscode.Uri.parse('brud-preview://preview-' + Date.now() + '.' + fileExtension);
          this._previewProvider.setContent(previewUri, createFileOps[0].content);

          const emptyDoc = await vscode.workspace.openTextDocument(emptyUri);
          if (emptyDoc.languageId !== languageId) {
            await vscode.languages.setTextDocumentLanguage(emptyDoc, languageId);
          }

          const previewDoc = await vscode.workspace.openTextDocument(previewUri);
          if (previewDoc.languageId !== languageId) {
            await vscode.languages.setTextDocumentLanguage(previewDoc, languageId);
          }

          await vscode.commands.executeCommand('vscode.diff', emptyUri, previewUri, 'Brud Preview: ' + filePath + ' (NEW FILE)');

          const headerMsg: ExtensionMessage = {
            command: 'updatePreviewHeader',
            fileName: filePath,
            fileIndex: this._currentFileIndex,
            totalFiles: this._fileList.length,
          };
          this._view?.webview.postMessage(headerMsg);
          return;
        }
        const errMsg: ExtensionMessage = { command: 'error', message: `Could not open file: ${filePath}` };
        this._view?.webview.postMessage(errMsg);
        const headerMsg2: ExtensionMessage = {
          command: 'updatePreviewHeader',
          fileName: filePath,
          fileIndex: this._currentFileIndex,
          totalFiles: this._fileList.length,
        };
        this._view?.webview.postMessage(headerMsg2);
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
        const errMsg: ExtensionMessage = { command: 'error', message: msg };
        this._view?.webview.postMessage(errMsg);
        if (block) {
          this._outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
          this._outputChannel.appendLine(`SEARCH_CONTENT: ${JSON.stringify(block.search)}`);
          this._outputChannel.show(true);
        }
      });

      if (!matches) {
        const headerMsg: ExtensionMessage = {
          command: 'updatePreviewHeader',
          fileName: filePath,
          fileIndex: this._currentFileIndex,
          totalFiles: this._fileList.length,
        };
        this._view?.webview.postMessage(headerMsg);
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

      const headerMsg: ExtensionMessage = {
        command: 'updatePreviewHeader',
        fileName: filePath,
        fileIndex: this._currentFileIndex,
        totalFiles: this._fileList.length,
      };
      this._view?.webview.postMessage(headerMsg);
      return;
    }

    const errMsg: ExtensionMessage = { command: 'error', message: 'Preview not available for this operation type.' };
    this._view?.webview.postMessage(errMsg);
    const headerMsg2: ExtensionMessage = {
      command: 'updatePreviewHeader',
      fileName: filePath,
      fileIndex: this._currentFileIndex,
      totalFiles: this._fileList.length,
    };
    this._view?.webview.postMessage(headerMsg2);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview'),
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this._getReactHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
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
    const showMsg: ExtensionMessage = { command: 'showPreviewNavigation' };
    this._view?.webview.postMessage(showMsg);
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

    const headerMsg: ExtensionMessage = {
      command: 'updatePreviewHeader',
      fileName: 'All Files',
      fileIndex: -1,
      totalFiles: this._fileList.length,
    };
    this._view?.webview.postMessage(headerMsg);
  }

  private async _removeFileFromPreview(filePath: string) {
    const idx = this._fileList.indexOf(filePath);
    if (idx === -1) {
      return;
    }

    this._fileList.splice(idx, 1);
    this._operationsByFile.delete(filePath);

    if (this._currentFileIndex >= this._fileList.length) {
      this._currentFileIndex = 0;
    }

    await this._closePreviewTabs();

    if (this._fileList.length === 0) {
      const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
      this._view?.webview.postMessage(hideMsg);
    } else if (idx === this._currentFileIndex) {
      await this._showPreviewForFile(this._fileList[this._currentFileIndex]);
    }
  }

  private async _handleExecuteCurrentFile() {
    if (this._fileList.length === 0 || this._currentFileIndex < 0 || this._currentFileIndex >= this._fileList.length) {
      return;
    }

    const filePath = this._fileList[this._currentFileIndex];
    const operations = this._operationsByFile.get(filePath) || [];
    const result = await executeFileOperations(operations);
    this._reportExecutionResult(result);

    if (result.success) {
      this._removeFileFromPreview(filePath);
    }
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

    if (result.success) {
      for (const filePath of this._fileList) {
        await this._closePreviewTabs();
      }
      this._fileList = [];
      this._operationsByFile.clear();
      this._currentFileIndex = 0;
      const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
      this._view?.webview.postMessage(hideMsg);
    }
  }

  private _reportExecutionResult(result: ExecutionResult) {
    this._outputChannel.appendLine(result.message);
    for (const err of result.errors) {
      this._outputChannel.appendLine(`  ERROR: ${err}`);
    }

    if (result.success && result.errors.length === 0) {
      const msg: ExtensionMessage = { command: 'success', message: result.message };
      this._view?.webview.postMessage(msg);
    } else if (result.success && result.errors.length > 0) {
      const msg: ExtensionMessage = { command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') };
      this._view?.webview.postMessage(msg);
    } else {
      const msg: ExtensionMessage = { command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') };
      this._view?.webview.postMessage(msg);
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
      const msg: ExtensionMessage = { command: 'error', message: errorMessage };
      this._view.webview.postMessage(msg);
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

  // Legacy HTML webview - kept for reference, will be removed after full migration.
  private _getHtmlForWebview(webview: vscode.Webview) {
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'main.html');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'bridge.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'resources', 'webview', 'styles.css'));

    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    html = html.replace('{{styleUri}}', styleUri.toString());
    html = html.replace('{{scriptUri}}', scriptUri.toString());

    return html;
  }

  private _getReactHtmlForWebview(webview: vscode.Webview): string {
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
    html = html.replace('<div id="root">', `<div id="root" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}
