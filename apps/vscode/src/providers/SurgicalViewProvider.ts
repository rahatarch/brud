import * as vscode from 'vscode';
import * as fs from 'fs';
import { findMatches, reconstructContent } from '@brud/core';
import { getWorkspaceFolders } from '@brud/vscode-adapter';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { BrudDiffPreviewPanelManager } from './DiffPreviewPanelProvider';
import { BrudAPI } from '@brud/core';
import { fileOpenError, previewNotAvailableError } from '@brud/core';
import type { ValidationResult } from '@brud/core';
import { PatchBlock, FileOperation } from '@brud/core';
import type { WebviewMessage, ExtensionMessage, ReportSection } from '@brud/protocol';
import { SurgicalViewDependencies } from './SurgicalViewDependencies';
import { SurgicalViewRouter } from './SurgicalViewRouter';

export class BrudSRViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _operationsByFile: Map<string, FileOperation[]> = new Map();
  private _fileList: string[] = [];
  private _currentFileIndex: number = 0;
  private _mainWindowProvider: any;
  private _structurePanelManager: any;
  private _readPanelManager: any;
  private _unifiedResultsPanelManager: any;
  private _diffPreviewPanelManager: BrudDiffPreviewPanelManager;
  private _originalPrompt: string = '';
  private _diffPreviewSessionId: string | undefined = undefined;
  private _lastExecutionResult: { operations: { toolKind: string; data: any }[] } | null = null;

  private _deps: SurgicalViewDependencies;
  private _router: SurgicalViewRouter;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _previewProvider: BrudCodePreviewProvider,
    mainWindowProvider?: any,
    structurePanelManager?: any,
    readPanelManager?: any,
    diffPreviewPanelManager?: BrudDiffPreviewPanelManager,
    unifiedResultsPanelManager?: any,
  ) {
    this._mainWindowProvider = mainWindowProvider;
    this._structurePanelManager = structurePanelManager;
    this._readPanelManager = readPanelManager;
    this._unifiedResultsPanelManager = unifiedResultsPanelManager;
    this._diffPreviewPanelManager = diffPreviewPanelManager || new BrudDiffPreviewPanelManager(_extensionUri);

    this._deps = new SurgicalViewDependencies(
      _extensionUri,
      _outputChannel,
      _previewProvider,
      mainWindowProvider,
      structurePanelManager,
      readPanelManager,
      this._diffPreviewPanelManager,
      unifiedResultsPanelManager,
      () => this._fileList,
      () => this._currentFileIndex,
      (idx) => { this._currentFileIndex = idx; },
      () => this._operationsByFile,
      (map) => { this._operationsByFile = map; },
      (list) => { this._fileList = list; },
      () => this._originalPrompt,
      (val) => { this._originalPrompt = val; },
      () => this._diffPreviewSessionId,
      (id) => { this._diffPreviewSessionId = id; },
      () => this._view?.webview,
      () => this._lastExecutionResult,
      (val) => { this._lastExecutionResult = val; },
      () => { this._fileList = []; },
      () => { this._operationsByFile.clear(); },
      () => { this._currentFileIndex = 0; },
      async (filePath) => { await this._showPreviewForFile(filePath); },
    );

    this._deps.wireHandlers();
    this._router = new SurgicalViewRouter(this._deps, () => this._lastExecutionResult);
  }

  private async _showPreviewForFile(filePath: string) {
    const result = BrudAPI.validate.path(filePath, getWorkspaceFolders());
    if (!result.success) {
      this._sendErrorToWebview(result);
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

      await vscode.commands.executeCommand('vscode.diff', emptyUri, previewUri, 'Brud Code Preview: ' + filePath + ' (NEW FILE)');

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
        document = await vscode.workspace.openTextDocument(vscode.Uri.file((result.data as any).resolvedPath));
      } catch {
        this._sendErrorToWebview(fileOpenError(filePath));
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

      await vscode.commands.executeCommand('vscode.diff', originalUri, previewUri, 'Brud Code Preview: ' + filePath + ' (APPENDED)');

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
        document = await vscode.workspace.openTextDocument(vscode.Uri.file((result.data as any).resolvedPath));
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

          await vscode.commands.executeCommand('vscode.diff', emptyUri, previewUri, 'Brud Code Preview: ' + filePath + ' (NEW FILE)');

          const headerMsg: ExtensionMessage = {
            command: 'updatePreviewHeader',
            fileName: filePath,
fileIndex: this._currentFileIndex,
            totalFiles: this._fileList.length,
          };
          this._view?.webview.postMessage(headerMsg);
          return;
        }
        this._sendErrorToWebview(fileOpenError(filePath));
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
        this._sendErrorToWebview(msg);
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
        `Brud Code Preview: ${document.fileName} (PATCHED)`,
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

    this._sendErrorToWebview(previewNotAvailableError());
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
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this._getReactHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      await this._router.handle(data);
    });
  }

  private _generateErrorReport(error: string | { code: string; friendly: string; details: string; path?: string; command?: string } | ValidationResult): ReportSection[] {
    const sections: ReportSection[] = [];

    let friendlyMessage: string;
    let detailMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
      detailMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong. Here are the details:';
      detailMessage = error.details || friendlyMessage;
    }

    if (detailMessage !== friendlyMessage) {
      sections.push({ type: 'details', title: 'Error Details', content: detailMessage });
    }
    sections.push({ type: 'button', buttonText: 'See Details', buttonAction: 'openUnifiedResults' });

    return sections;
  }

  private _sendErrorToWebview(error: string | { code: string; friendly: string; details: string; path?: string; command?: string } | ValidationResult): void {
    const structured = this._generateErrorReport(error);
    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong.';
    }

    this._unifiedResultsPanelManager?.openUnifiedResultsPanel({
      operations: [{
        toolKind: 'error',
        data: { structured, friendlyMessage },
      }],
    });

    if (this._view) {
      const msg: ExtensionMessage = { command: 'error', message: 'Failed. Check the report at the Report Panel.' };
      this._view.webview.postMessage(msg);
    }
    this._outputChannel.appendLine('ERROR: ' + friendlyMessage);
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
    html = html.replace('<div id="root">', `<div id="root" data-view-mode="sidebar" data-image-uri="${logoUri.toString()}">`);

    return html;
  }
}
