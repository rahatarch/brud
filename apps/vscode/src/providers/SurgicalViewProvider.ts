import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseOperations } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { executeOperationsFromVSCode, getWorkspaceFolders, VSCodeFileSystem, WorkspaceHistoryStore } from '@brud/vscode-adapter';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { BrudDiffPreviewPanelManager } from './DiffPreviewPanelProvider';
import { validateWorkspacePath } from '@brud/core';
import { PatchBlock, FileOperation } from '@brud/core';
import { extractDirectoryStructure } from '@brud/core';
import { createTwoFilesPatch } from 'diff';
import type { WebviewMessage, ExtensionMessage, ExecutionResult, OperationResult, StructureResult, CodebaseMetadataResult, ReadResultData, DiffPreviewData, DiffFileEntry } from '@brud/protocol';

function countStructure(obj: Record<string, any>, files = 0, dirs = 0): { files: number; dirs: number } {
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string') {
          files++;
        } else if (typeof item === 'object' && item !== null) {
          dirs++;
          const result = countStructure(item, files, dirs);
          files = result.files;
          dirs = result.dirs;
        }
      }
    }
  }
  return { files, dirs };
}

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
    this._diffPreviewPanelManager.setMessageHandler((msg) => {
      this._handleDiffPreviewPanelMessage(msg);
    });
  }

  private _groupOperationsByFile(operations: FileOperation[]): Map<string, FileOperation[]> {
    const grouped = new Map<string, FileOperation[]>();
    for (const op of operations) {
      const key = op.kind === 'rename_file' || op.kind === 'move_file' || op.kind === 'copy_file'
        ? op.from
        : op.kind === 'create_directory'
        ? op.directoryPath
        : op.kind === 'delete_directory'
        ? op.directoryPath
        : op.kind === 'move_directory'
        ? op.from
        : op.kind === 'extract_structure'
        ? op.directoryPath
        : op.kind === 'codebase_metadata'
        ? '__codebase_metadata__'
        : op.kind === 'search_files'
        ? '__search_files__'
        : op.kind === 'append_file_multi'
        ? '__append_file_multi__'
        : op.kind === 'search_replace_multi'
        ? '__search_replace_multi__'
        : op.kind === 'read_file'
        ? op.path
        : op.kind === 'read_files'
        ? '__read_files__'
        : op.kind === 'read_directory'
        ? op.directoryPath
        : op.kind === 'terminal_interactive'
        ? '__terminal_interactive__'
        : (op as any).path;
      const existing = grouped.get(key) || [];
      existing.push(op);
      grouped.set(key, existing);
    }
    return grouped;
  }

  private async _showPreviewForFile(filePath: string) {
    const result = validateWorkspacePath(filePath, getWorkspaceFolders());
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
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.resolvedPath));
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
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.resolvedPath));
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
        vscode.Uri.joinPath(this._extensionUri, 'dist', 'webview'),
      ],
    };

    webviewView.webview.html = this._getReactHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      switch (data.command) {
        case 'applyPatch':
          await this._handleApplyPatch(data.text ?? '');
          break;
        case 'previewPatch':
          await this._handlePreviewPatch(data.text ?? '');
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
          await this._handleExecuteCurrentFile(data.fileIndex);
          break;
        case 'executeAllFiles':
          await this._handleExecuteAllFiles();
          break;
        case 'rejectPreview':
          await this._handleRejectPreview();
          break;
        case 'extractStructure':
          await this._handleExtractStructure(data.text ?? '');
          break;
        case 'openMainWindow':
          vscode.commands.executeCommand('brud.openManagement');
          break;
      }
    });
  }

  private async _handlePreviewPatch(text: string) {
    this._originalPrompt = text;
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

    const diffFiles: DiffFileEntry[] = [];

    for (const filePath of this._fileList) {
      const result = validateWorkspacePath(filePath, getWorkspaceFolders());
      const fileOps = this._operationsByFile.get(filePath) || [];
      const searchReplaceOps = fileOps.filter(op => op.kind === 'search_replace');
      const createFileOps = fileOps.filter(op => op.kind === 'create_file');
      const appendFileOps = fileOps.filter(op => op.kind === 'append_file');

      let originalContent = '';
      let modifiedContent = '';

      if (result.valid) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.resolvedPath));
          const docLines: string[] = [];
          for (let i = 0; i < document.lineCount; i++) {
            docLines.push(document.lineAt(i).text);
          }
          originalContent = docLines.join('\n');
        } catch {
          originalContent = '';
        }
      }

      if (createFileOps.length > 0) {
        modifiedContent = createFileOps[0].content;
      } else if (appendFileOps.length > 0) {
        modifiedContent = originalContent;
        for (const op of appendFileOps) {
          if (op.position === 'end') {
            modifiedContent += op.content;
          } else {
            modifiedContent = op.content + modifiedContent;
          }
        }
      } else if (searchReplaceOps.length > 0) {
        const blocks: PatchBlock[] = searchReplaceOps.map(op => ({
          index: op.index,
          search: op.search,
          searchMeat: op.search.replace(/\s+/g, ''),
          replace: op.replace,
        }));

        const docLines = originalContent.split('\n');
        const matches = findMatches(docLines, blocks, (msg, block) => {
          this._outputChannel.appendLine(`WARNING: ${msg}`);
          if (block) {
            this._outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
          }
        });

        if (matches) {
          modifiedContent = reconstructContent(docLines, matches);
        } else {
          modifiedContent = originalContent;
        }
      } else {
        modifiedContent = originalContent;
      }

      const fileExtension = filePath.split('.').pop() || '';
      const languageMap: Record<string, string> = {
        ts: 'typescript', tsx: 'typescriptreact', js: 'javascript',
        jsx: 'javascriptreact', json: 'json', css: 'css', html: 'html',
        md: 'markdown', py: 'python', rs: 'rust', go: 'go', java: 'java',
        cpp: 'cpp', c: 'c', h: 'c', hpp: 'cpp', yaml: 'yaml', yml: 'yaml',
        xml: 'xml', sh: 'shellscript', bash: 'shellscript', sql: 'sql',
        vue: 'vue', svelte: 'svelte', scss: 'scss', less: 'less',
      };

      diffFiles.push({
        filePath,
        originalContent,
        modifiedContent,
        languageId: languageMap[fileExtension] || 'plaintext',
      });
    }

    const diffPreviewData: DiffPreviewData = {
      files: diffFiles,
      currentIndex: 0,
    };

    this._diffPreviewPanelManager.openDiffPreview(diffPreviewData);

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
      const result = validateWorkspacePath(filePath, getWorkspaceFolders());
      if (!result.valid) {
        continue;
      }

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file(result.resolvedPath));
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
    const firstFileResult = validateWorkspacePath(this._fileList[0], getWorkspaceFolders());
    if (!firstFileResult.valid) {
      return;
    }

    let firstDocument: vscode.TextDocument;
    try {
      firstDocument = await vscode.workspace.openTextDocument(vscode.Uri.file(firstFileResult.resolvedPath));
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
      'Brud Code Preview: All Files (PATCHED)',
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

  private async _handleExecuteCurrentFile(fileIndex?: number) {
    const idx = fileIndex !== undefined ? fileIndex : this._currentFileIndex;
    this._outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile called. fileIndex param=${fileIndex}, this._currentFileIndex=${this._currentFileIndex}, resolved idx=${idx}`);
    this._outputChannel.appendLine(`[DEBUG] _fileList contents: ${JSON.stringify(this._fileList)}`);
    
    if (this._fileList.length === 0 || idx < 0 || idx >= this._fileList.length) {
      this._outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: returning early - invalid idx=${idx}, _fileList.length=${this._fileList.length}`);
      return;
    }

    const filePath = this._fileList[idx];
    this._outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: selected filePath="${filePath}" at idx=${idx}`);
    const operations = this._operationsByFile.get(filePath) || [];
    const folders = getWorkspaceFolders();
    const historyStore = folders.length > 0 ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem()) : undefined;
    const result = await executeOperationsFromVSCode(operations, historyStore, this._originalPrompt, this._diffPreviewSessionId);
    const readData = this._reportExecutionResult(result);

    if (readData) {
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel({ readResults: readData });
    }

    if (result.success) {
      if (result.sessionId) {
        this._diffPreviewSessionId = result.sessionId;
      }

      this._diffPreviewPanelManager.postMessage({
        command: 'filePatched',
        fileIndex: idx,
      });

      await this._closePreviewTabs();
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

    const folders = getWorkspaceFolders();
    const historyStore = folders.length > 0 ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem()) : undefined;
    const result = await executeOperationsFromVSCode(allOperations, historyStore, this._originalPrompt, this._diffPreviewSessionId);
    const readData = this._reportExecutionResult(result);

    if (readData) {
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel({ readResults: readData });
    }

    if (result.success) {
      if (result.sessionId) {
        this._diffPreviewSessionId = result.sessionId;
      }

      this._diffPreviewPanelManager.postMessage({
        command: 'executeSuccess',
        message: `Successfully applied ${this._fileList.length} patches`,
      });
      await this._closePreviewTabs();
      this._fileList = [];
      this._operationsByFile.clear();
      this._currentFileIndex = 0;
      this._diffPreviewSessionId = undefined;
      const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
      this._view?.webview.postMessage(hideMsg);
    }
  }

  private async _handleRejectPreview() {
    this._diffPreviewPanelManager.closePanel();
    this._fileList = [];
    this._operationsByFile.clear();
    this._currentFileIndex = 0;
    this._diffPreviewSessionId = undefined;
    const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
    this._view?.webview.postMessage(hideMsg);
  }

  private async _handleDiffPreviewPanelMessage(message: any) {
    this._outputChannel.appendLine(`[DEBUG] _handleDiffPreviewPanelMessage received: ${JSON.stringify(message)}`);
    switch (message.command) {
      case 'executeCurrentFile':
        await this._handleExecuteCurrentFile(message.fileIndex);
        break;
      case 'executeAllFiles':
        await this._handleExecuteAllFiles();
        break;
      case 'rejectPreview':
        await this._handleRejectPreview();
        break;
      case 'doneDiffPreview':
        await this._handleRejectPreview();
        break;
      case 'closeDiffPreview':
        this._diffPreviewPanelManager.closePanel();
        break;
      case 'previewPrevFile':
        await this._handlePreviewPrevFile();
        break;
      case 'previewNextFile':
        await this._handlePreviewNextFile();
        break;
    }
  }

  private _reportExecutionResult(result: ExecutionResult): ReadResultData | null {
    this._outputChannel.appendLine(result.message);
    for (const err of result.errors) {
      this._outputChannel.appendLine(`  ERROR: ${err}`);
    }

    if (result.success) {
      let readData: any;
      try {
        readData = JSON.parse(result.message);
      } catch {
        readData = null;
      }

      const isReadResult = readData && (readData.totalFiles !== undefined || (Array.isArray(readData) && readData.some((d: any) => d.totalFiles !== undefined)));

      if (isReadResult) {
        const fileCount = Array.isArray(readData) ? readData.reduce((sum: number, d: any) => sum + d.totalFiles, 0) : readData.totalFiles;
        const report = `Read ${fileCount} file(s). Results available in the Read panel.`;
        const msg: ExtensionMessage = { command: 'success', message: report };
        this._view?.webview.postMessage(msg);

        const readResultData: ReadResultData = Array.isArray(readData)
          ? readData.reduce((merged: ReadResultData, d: any) => ({
              files: [...(merged.files || []), ...(d.files || [])],
              totalFiles: merged.totalFiles + (d.totalFiles || 0),
              totalSize: merged.totalSize + (d.totalSize || 0),
            }), { files: [], totalFiles: 0, totalSize: 0 })
          : readData;
        return readResultData;
      } else {
        const msg: ExtensionMessage = { command: 'success', message: result.message };
        this._view?.webview.postMessage(msg);
      }
    } else {
      const msg: ExtensionMessage = { command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') };
      this._view?.webview.postMessage(msg);
      this._outputChannel.show(true);
    }
    return null;
  }

  private async _handleApplyPatch(text: string) {
    await this._closePreviewTabs();
    this._outputChannel.appendLine('DEBUG: Before parseOperations');

    let operations;
    try {
      operations = parseOperations(text);
      this._outputChannel.appendLine('DEBUG: After parseOperations - operations count: ' + operations.length);
    } catch (e) {
      this._outputChannel.appendLine('DEBUG: parseOperations threw: ' + (e instanceof Error ? e.message : String(e)));
      this._sendErrorToWebview(e instanceof Error ? e.message : String(e));
      return;
    }

    const queryOps = operations.filter(op =>
      op.kind === 'extract_structure' ||
      op.kind === 'read_file' || op.kind === 'read_files' || op.kind === 'read_directory' ||
      op.kind === 'search_files' ||
      op.kind === 'codebase_metadata'
    );

    const fileOps = operations.filter(op =>
      op.kind !== 'extract_structure' &&
      op.kind !== 'read_file' && op.kind !== 'read_files' && op.kind !== 'read_directory' &&
      op.kind !== 'search_files' &&
      op.kind !== 'codebase_metadata'
    );

    let queryResult: { success: boolean; message: string; errors: string[]; operationResults: OperationResult[] } | null = null;
    let fileResult: { success: boolean; message: string; errors: string[]; operationResults: OperationResult[] } | null = null;
    const unifiedResults: Record<string, any> = {};

    if (queryOps.length > 0) {
      this._outputChannel.appendLine('DEBUG: Before executeFileOperations for query operations');
      queryResult = await executeFileOperations(queryOps, new VSCodeFileSystem(), getWorkspaceFolders());
      this._outputChannel.appendLine('DEBUG: After executeFileOperations - success: ' + queryResult.success + ' - errors: ' + queryResult.errors.length);

      for (const err of queryResult.errors) {
        this._outputChannel.appendLine(`  ERROR: ${err}`);
      }

      let parsedMessage: any;
      try {
        parsedMessage = JSON.parse(queryResult.message);
      } catch {
        parsedMessage = null;
      }

      if (parsedMessage && parsedMessage.extractionResults) {
        unifiedResults.extractionResults = parsedMessage.extractionResults.map((item: any) => ({
          json: item.json,
          directoryPath: item.directoryPath,
          depth: item.depth,
          fileCount: item.fileCount,
          directoryCount: item.directoryCount,
        }));
      }

      if (parsedMessage && parsedMessage.readResults) {
        unifiedResults.readResults = parsedMessage.readResults.reduce(
          (merged: any, d: any) => ({
            files: [...(merged.files || []), ...(d.files || [])],
            totalFiles: merged.totalFiles + (d.totalFiles || 0),
            totalSize: merged.totalSize + (d.totalSize || 0),
          }),
          { files: [], totalFiles: 0, totalSize: 0 }
        );
      }

      if (parsedMessage && parsedMessage.search_results) {
        const allResults = parsedMessage.search_results as Array<{ operationIndex: number; results: { results: any[]; totalMatches: number; truncated: boolean } }>;
        const merged = allResults.reduce((acc, entry) => ({
          results: [...(acc.results || []), ...(entry.results.results || [])],
          totalMatches: (acc.totalMatches || 0) + (entry.results.totalMatches || 0),
          truncated: acc.truncated || entry.results.truncated || false,
        }), { results: [] as any[], totalMatches: 0, truncated: false });
        unifiedResults.search_files = merged;
      }

      if (parsedMessage && parsedMessage.codebase_metadata) {
        unifiedResults.codebase_metadata = parsedMessage.codebase_metadata;
      }
    }

    if (fileOps.length > 0) {
      const folders = getWorkspaceFolders();
      const historyStore = folders.length > 0 ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem()) : undefined;
      fileResult = await executeOperationsFromVSCode(fileOps, historyStore, text);
    }

    if (Object.keys(unifiedResults).length > 0) {
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel(unifiedResults);
    }

    const combinedMessages: string[] = [];
    let combinedSuccess = true;
    const combinedErrors: string[] = [];

    if (queryResult) {
      combinedMessages.push(queryResult.message);
      combinedSuccess = combinedSuccess && queryResult.success;
      combinedErrors.push(...queryResult.errors);
    }

    if (fileResult) {
      combinedMessages.push(fileResult.message);
      combinedSuccess = combinedSuccess && fileResult.success;
      combinedErrors.push(...fileResult.errors);
    }

    const report = combinedMessages.join('\n');

    if (combinedSuccess) {
      const msg: ExtensionMessage = { command: 'success', message: report };
      this._view?.webview.postMessage(msg);
    } else {
      this._outputChannel.appendLine('=== EXECUTION SUMMARY ===');
      this._outputChannel.appendLine('Query result: ' + JSON.stringify(queryResult));
      this._outputChannel.appendLine('File result: ' + JSON.stringify(fileResult));
      this._outputChannel.show(true);
      const msg: ExtensionMessage = { command: 'error', message: report + (combinedErrors.length > 0 ? '\n\nErrors:\n' + combinedErrors.map(e => `- ${e}`).join('\n') : '') };
      this._view?.webview.postMessage(msg);
    }
  }

  private async _handleExtractStructure(text: string) {
    await this._closePreviewTabs();

    let operations;
    try {
      operations = parseOperations(text);
    } catch (e) {
      this._sendErrorToWebview(e instanceof Error ? e.message : String(e));
      return;
    }

    const extractOps = operations.filter(op => op.kind === 'extract_structure');
    if (extractOps.length === 0) {
      this._sendErrorToWebview('No extract_structure operations found.');
      return;
    }

    const result = await executeFileOperations(extractOps, new VSCodeFileSystem(), getWorkspaceFolders());
    if (!result.success) {
      this._outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this._outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
      this._outputChannel.appendLine('Result: ' + JSON.stringify(result));
      this._outputChannel.appendLine('DirectoryPath: ' + (extractOps[0] as any).directoryPath);
      this._outputChannel.appendLine('Depth: ' + (extractOps[0] as any).depth);
      this._outputChannel.show(true);
      const errMsg: ExtensionMessage = { command: 'error', message: result.message + (result.errors.length > 0 ? ' Errors: ' + result.errors.join('; ') : '') };
      this._view?.webview.postMessage(errMsg);
      return;
    }

    if (result.errors.length > 0) {
      this._outputChannel.appendLine('Extraction had errors: ' + result.errors.join('; '));
      const errMsg: ExtensionMessage = { command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') };
      this._view?.webview.postMessage(errMsg);
      return;
    }

    let structureResults: StructureResult[] = [];
    try {
      const parsed = JSON.parse(result.message);
      const parsedArray = Array.isArray(parsed) ? parsed : [parsed];
      structureResults = parsedArray.map((item: any) => ({
        json: item.json,
        directoryPath: item.directoryPath,
        depth: item.depth,
        fileCount: item.fileCount,
        directoryCount: item.directoryCount,
      }));
    } catch (e) {
      this._outputChannel.appendLine('Error parsing extract_structure result: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    const structureNames = structureResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
    const successMsg: ExtensionMessage = { command: 'success', message: `Extracted directory structure${extractOps.length > 1 ? 's' : ''} from ${structureNames}. Results available in the Structure panel.` };
    this._view?.webview.postMessage(successMsg);
    this._unifiedResultsPanelManager?.openUnifiedResultsPanel({ extractionResults: structureResults });
    this._outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
  }

  private _generateReport(
    operations: FileOperation[],
    result: { success: boolean; message: string; errors: string[]; operationResults: OperationResult[] }
  ): string {
    const lines: string[] = [];

    for (const opResult of result.operationResults) {
      lines.push(opResult.message);
    }

    const report = [result.message, ...lines].join('\n');

    const failedCount = result.operationResults
      ? result.operationResults.filter(r => r.status === 'failed').length
      : 0;

    if (failedCount > 0) {
      return report + '\n\nErrors:\n' + result.errors.map(e => `- ${e}`).join('\n');
    }

    return report;
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
