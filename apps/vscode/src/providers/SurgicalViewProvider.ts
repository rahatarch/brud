import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseOperations, cleanBrudInput, BrudError } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { executeOperationsFromVSCode, getWorkspaceFolders, VSCodeFileSystem, WorkspaceHistoryStore } from '@brud/vscode-adapter';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { BrudDiffPreviewPanelManager } from './DiffPreviewPanelProvider';
import { BrudAPI } from '@brud/core';
import { fileOpenError, previewNotAvailableError, noValidOperationsError, noPreviewError, noExtractOperationsError, executionFailedError, parseError } from '@brud/core';
import type { ValidationResult } from '@brud/core';
import { PatchBlock, FileOperation } from '@brud/core';
import { extractDirectoryStructure } from '@brud/core';
import { createTwoFilesPatch } from 'diff';
import type { WebviewMessage, ExtensionMessage, ExecutionResult, OperationResult, StructureResult, CodebaseMetadataResult, ReadResultData, DiffPreviewData, DiffFileEntry, ReportSection } from '@brud/protocol';
import { ExecutionCoordinator } from './services/ExecutionCoordinator';
import { PanelManager } from './services/PanelManager';
import { ErrorReporter } from './services/ErrorReporter';
import { WorkspaceResolver } from './services/WorkspaceResolver';
import { ApplyPatchHandler } from './handlers/ApplyPatchHandler';
import { ExecuteCurrentFileHandler } from './handlers/ExecuteCurrentFileHandler';
import { ExecuteAllFilesHandler } from './handlers/ExecuteAllFilesHandler';
import { ExtractStructureHandler } from './handlers/ExtractStructureHandler';
import { ManagementHandler } from './handlers/ManagementHandler';
import { GetStartedHandler } from './handlers/GetStartedHandler';

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
  private _lastExecutionResult: { operations: { toolKind: string; data: any }[] } | null = null;

  // Phase 3.1 — New services and handlers (coexisting with old code)
  private workspaceResolver: WorkspaceResolver;
  private executionCoordinator: ExecutionCoordinator;
  private errorReporter: ErrorReporter;
  private panelManager: PanelManager;
  private applyPatchHandler: ApplyPatchHandler;
  private executeCurrentFileHandler: ExecuteCurrentFileHandler;
  private executeAllFilesHandler: ExecuteAllFilesHandler;
  private extractStructureHandler: ExtractStructureHandler;
  private managementHandler: ManagementHandler;
  private getStartedHandler: GetStartedHandler;

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

    // Phase 3.1 — Instantiate services and handlers (coexisting with old code)
    this.workspaceResolver = new WorkspaceResolver();
    this.executionCoordinator = new ExecutionCoordinator();
    this.errorReporter = new ErrorReporter(
      () => this._view?.webview,
      () => this._unifiedResultsPanelManager,
      this._outputChannel,
    );
    this.panelManager = new PanelManager(
      this._unifiedResultsPanelManager,
      this._diffPreviewPanelManager,
      this._mainWindowProvider,
      this._structurePanelManager,
      this._readPanelManager,
    );
    this.applyPatchHandler = new ApplyPatchHandler(
      this._outputChannel,
      this.errorReporter,
      this.panelManager,
      this.executionCoordinator,
      () => this._view?.webview,
      () => this._lastExecutionResult,
      (val) => { this._lastExecutionResult = val; },
    );
    this.executeCurrentFileHandler = new ExecuteCurrentFileHandler(
      this._outputChannel,
      this.panelManager,
      this.executionCoordinator,
      this.workspaceResolver,
      () => this._fileList,
      () => this._currentFileIndex,
      () => this._operationsByFile,
      () => this._originalPrompt,
      () => this._diffPreviewSessionId,
      (id) => { this._diffPreviewSessionId = id; },
      () => this._view?.webview,
    );
    this.executeAllFilesHandler = new ExecuteAllFilesHandler(
      this._outputChannel,
      this.panelManager,
      this.executionCoordinator,
      this.workspaceResolver,
      () => this._fileList,
      () => this._currentFileIndex,
      () => this._operationsByFile,
      () => this._originalPrompt,
      () => this._diffPreviewSessionId,
      (id) => { this._diffPreviewSessionId = id; },
      () => this._view?.webview,
      () => { this._fileList = []; },
      () => { this._operationsByFile.clear(); },
      () => { this._currentFileIndex = 0; },
    );
    this.extractStructureHandler = new ExtractStructureHandler(
      this._outputChannel,
      this.panelManager,
      this.errorReporter,
      () => this._view?.webview,
    );
    this.managementHandler = new ManagementHandler();
    this.getStartedHandler = new GetStartedHandler();
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
      switch (data.command) {
        case 'applyPatch':
          await this.applyPatchHandler.handle(data.text ?? '');
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
          await this.executeCurrentFileHandler.handle(data.fileIndex);
          break;
        case 'executeAllFiles':
          await this.executeAllFilesHandler.handle();
          break;
        case 'rejectPreview':
          await this._handleRejectPreview();
          break;
        case 'extractStructure':
          await this.extractStructureHandler.handle(data.text ?? '');
          break;
        case 'openMainWindow':
          await this.managementHandler.handle();
          break;
        case 'openPromptLibrary':
          await this.managementHandler.handle();
          break;
        case 'openGetStarted':
          await this.getStartedHandler.handle();
          break;
        case 'openUnifiedResults':
          if (this._lastExecutionResult) {
            this._unifiedResultsPanelManager?.openUnifiedResultsPanel(this._lastExecutionResult);
          }
          break;
        case 'previewNoChanges':
          this._diffPreviewPanelManager.openNoPreviewPanel('No changes found. The search text was not found in any of the files.');
          break;
      }
    });
  }

  private async _handlePreviewPatch(text: string) {
    this._originalPrompt = text;
    let operations;
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
    } catch (e) {
      if (e instanceof BrudError) {
        this._sendParseErrorToWebview(e);
      } else {
        this._sendParseErrorToWebview(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    this._operationsByFile = this._groupOperationsByFile(operations);
    this._fileList = Array.from(this._operationsByFile.keys());
    this._currentFileIndex = 0;

    if (this._fileList.length === 0) {
      this._sendErrorToWebview(noValidOperationsError());
      return;
    }

    const previewableKinds = new Set(['search_replace', 'create_file', 'append_file']);
    const hasPreviewableOps = operations.some(op => previewableKinds.has(op.kind));

    if (!hasPreviewableOps) {
      this._diffPreviewPanelManager.openNoPreviewPanel();
      return;
    }

    const diffFiles: DiffFileEntry[] = [];

    for (const filePath of this._fileList) {
      const result = BrudAPI.validate.path(filePath, getWorkspaceFolders());
      const fileOps = this._operationsByFile.get(filePath) || [];
      const searchReplaceOps = fileOps.filter(op => op.kind === 'search_replace');
      const createFileOps = fileOps.filter(op => op.kind === 'create_file');
      const appendFileOps = fileOps.filter(op => op.kind === 'append_file');

      let originalContent = '';
      let modifiedContent = '';

      if (result.success) {
        try {
          const document = await vscode.workspace.openTextDocument(vscode.Uri.file((result.data as any).resolvedPath));
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
        let hasContentChange = false;
        for (const op of appendFileOps) {
          if (op.content && op.content.length > 0) {
            hasContentChange = true;
            if (op.position === 'end') {
              modifiedContent += op.content;
            } else {
              modifiedContent = op.content + modifiedContent;
            }
          }
        }
        if (!hasContentChange) {
          continue;
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
          continue;
        }
      } else {
        continue;
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

    if (diffFiles.length === 0) {
      const searchBlocks = operations
        .filter(op => op.kind === 'search_replace')
        .map(op => (op as any).search)
        .filter(Boolean);
      const searchText = searchBlocks.length > 0
        ? searchBlocks.join('\n\n---\n\n')
        : 'N/A';
      const copyMessage = "The search text was not found in the file. Please check the content and provide the correct search block.";
      const structured: ReportSection[] = [
        {
          type: 'text',
          content: "I couldn't find the search text in your files. This usually means the content has changed since you got the block from your AI, or there's a formatting mismatch.",
        },
        {
          type: 'details',
          title: 'Search Text',
          content: searchText,
        },
        {
          type: 'button',
          buttonText: 'See Details',
          buttonAction: 'previewNoChanges',
        },
      ];
      const msg: ExtensionMessage = { command: 'previewNoChanges', message: 'No changes found.', structured };
      this._view?.webview.postMessage(msg);
      this._diffPreviewPanelManager.openNoPreviewPanel('No changes found. The search text was not found in any of the files.');
      return;
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
      const result = BrudAPI.validate.path(filePath, getWorkspaceFolders());
      if (!result.success) {
        continue;
      }

      let document: vscode.TextDocument;
      try {
        document = await vscode.workspace.openTextDocument(vscode.Uri.file((result.data as any).resolvedPath));
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
      this._sendErrorToWebview(noPreviewError());
      return;
    }

    const combinedContent = combinedParts.join('\n\n');
    const firstFileResult = BrudAPI.validate.path(this._fileList[0], getWorkspaceFolders());
    if (!firstFileResult.success) {
      return;
    }

    let firstDocument: vscode.TextDocument;
    try {
      firstDocument = await vscode.workspace.openTextDocument(vscode.Uri.file((firstFileResult.data as any).resolvedPath));
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

    const terminalOps = this._toTerminalOperationData(result.operationResults, operations);

    const unifiedOps: { toolKind: string; data: any }[] = [];
    if (readData) unifiedOps.push({ toolKind: 'readResults', data: readData });
    unifiedOps.push(...terminalOps);

    for (const op of result.operationResults) {
      if (op.kind !== 'terminal_command') {
        unifiedOps.push({ toolKind: op.kind, data: op });
      }
    }

    for (const op of result.operationResults) {
      if (op.kind === 'terminal_command' && !op.data) {
        const origOp = operations[op.operationIndex] as any;
        unifiedOps.push({
          toolKind: 'terminal_command',
          data: {
            command: origOp?.command || (origOp?.commands ? origOp.commands.join(' && ') : op.message || ''),
            output: op.message || '',
            exitCode: null,
            duration: 0,
            success: false,
          },
        });
      }
    }

    if (unifiedOps.length > 0) {
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel({ operations: unifiedOps });
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

    const terminalOps = this._toTerminalOperationData(result.operationResults, allOperations);

    const unifiedOps: { toolKind: string; data: any }[] = [];
    if (readData) unifiedOps.push({ toolKind: 'readResults', data: readData });
    unifiedOps.push(...terminalOps);

    for (const op of result.operationResults) {
      if (op.kind !== 'terminal_command') {
        unifiedOps.push({ toolKind: op.kind, data: op });
      }
    }

    for (const op of result.operationResults) {
      if (op.kind === 'terminal_command' && !op.data) {
        const origOp = allOperations[op.operationIndex] as any;
        unifiedOps.push({
          toolKind: 'terminal_command',
          data: {
            command: origOp?.command || (origOp?.commands ? origOp.commands.join(' && ') : op.message || ''),
            output: op.message || '',
            exitCode: null,
            duration: 0,
            success: false,
          },
        });
      }
    }

    if (unifiedOps.length > 0) {
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel({ operations: unifiedOps });
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

  private _toTerminalOperationData(
    operationResults: OperationResult[],
    originalOperations: FileOperation[],
  ): { toolKind: 'terminal_command'; data: any }[] {
    const result: { toolKind: 'terminal_command'; data: any }[] = [];
    for (const op of operationResults) {
      if (op.kind !== 'terminal_command' || !op.data) continue;
      if (Array.isArray(op.data)) {
        const originalOp = originalOperations[op.operationIndex] as any;
        let mode: 'single' | 'sequential' | 'parallel' | 'conditional' = 'sequential';
        if (originalOp) {
          if (originalOp.mode === 'parallel') {
            mode = 'parallel';
          } else if (originalOp.onSuccess || originalOp.onFailure) {
            mode = 'conditional';
          } else {
            mode = 'sequential';
          }
        }
        const succeeded = op.data.filter((d: any) => d.success).length;
        const failed = op.data.filter((d: any) => !d.success).length;
        const totalDuration = op.data.reduce((sum: number, d: any) => sum + (d.duration || 0), 0);
        result.push({
          toolKind: 'terminal_command',
          data: {
            mode,
            results: op.data,
            totalDuration,
            succeeded,
            failed,
          },
        });
      } else {
        result.push({ toolKind: 'terminal_command', data: op.data });
      }
    }
    return result;
  }

  private _getChatStatusMessage(result: { success: boolean; operationResults?: any[]; errors?: any[] }): string {
    if (result.success && (!result.errors || result.errors.length === 0)) {
      return 'Successful. Check the report at the Report Panel.';
    }

    if (result.operationResults && result.operationResults.length > 0) {
      const successCount = result.operationResults.filter(r => r.status === 'success').length;
      if (successCount > 0) {
        return 'Partially succeeded. Please check the report at the Report Panel.';
      }
    }

    return 'Failed. Check the report at the Report Panel.';
  }

  private _reportExecutionResult(result: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] }): ReadResultData | null {
    this._outputChannel.appendLine(result.message);
    for (const err of result.errors) {
      this._outputChannel.appendLine(`  ERROR: ${err.details}`);
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
        const readResultData: ReadResultData = Array.isArray(readData)
          ? readData.reduce((merged: ReadResultData, d: any) => ({
              files: [...(merged.files || []), ...(d.files || [])],
              totalFiles: merged.totalFiles + (d.totalFiles || 0),
              totalSize: merged.totalSize + (d.totalSize || 0),
            }), { files: [], totalFiles: 0, totalSize: 0 })
          : readData;
        return readResultData;
      }
    }

    const pointerMsg = this._getChatStatusMessage(result);
    const command = result.success ? 'success' : 'error';
    const msg: ExtensionMessage = { command, message: pointerMsg };
    this._view?.webview.postMessage(msg);

    if (!result.success) {
      this._outputChannel.show(true);
    }

    return null;
  }

  private async _handleApplyPatch(text: string) {
    await this._closePreviewTabs();
    this._diffPreviewPanelManager.closePanel();
    this._outputChannel.appendLine('DEBUG: Before parseOperations');

    let operations;
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
      this._outputChannel.appendLine('DEBUG: After parseOperations - operations count: ' + operations.length);
    } catch (e) {
      this._outputChannel.appendLine('DEBUG: parseOperations threw: ' + (e instanceof Error ? e.message : String(e)));
      if (e instanceof BrudError) {
        this._sendParseErrorToWebview(e);
      } else {
        this._sendParseErrorToWebview(e instanceof Error ? e.message : String(e));
      }
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

    let queryResult: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] } | null = null;
    let fileResult: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] } | null = null;
    const unifiedResults: { operations: { toolKind: string; data: any }[] } = { operations: [] };

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
        for (const item of parsedMessage.extractionResults) {
          unifiedResults.operations.push({
            toolKind: 'extractionResults',
            data: {
              json: item.json,
              directoryPath: item.directoryPath,
              depth: item.depth,
              fileCount: item.fileCount,
              directoryCount: item.directoryCount,
            },
          });
        }
      }

      if (parsedMessage && parsedMessage.readResults) {
        for (const d of parsedMessage.readResults) {
          unifiedResults.operations.push({
            toolKind: 'readResults',
            data: {
              files: d.files || [],
              totalFiles: d.totalFiles || 0,
              totalSize: d.totalSize || 0,
            },
          });
        }
      }

      if (parsedMessage && parsedMessage.search_results) {
        const searchResults = parsedMessage.search_results as Array<{ operationIndex: number; results: { results: any[]; totalMatches: number; truncated: boolean } }>;
        for (const entry of searchResults) {
          unifiedResults.operations.push({
            toolKind: 'search_files',
            data: {
              results: entry.results.results || [],
              totalMatches: entry.results.totalMatches || 0,
              truncated: entry.results.truncated || false,
            },
          });
        }
      }

      if (parsedMessage && parsedMessage.codebase_metadata) {
        unifiedResults.operations.push({
          toolKind: 'codebase_metadata',
          data: parsedMessage.codebase_metadata,
        });
      }
    }

    if (fileOps.length > 0) {
      const folders = getWorkspaceFolders();
      const historyStore = folders.length > 0 ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem()) : undefined;
      fileResult = await executeOperationsFromVSCode(fileOps, historyStore, text);

      for (const opResult of fileResult.operationResults) {
  if (opResult.kind === 'terminal_command' && opResult.data) {
    const items = this._toTerminalOperationData([opResult], fileOps);
    unifiedResults.operations.push(...items);
  } else if (opResult.kind === 'terminal_command' && !opResult.data) {
    const origOp = fileOps[opResult.operationIndex] as any;
    unifiedResults.operations.push({
      toolKind: 'terminal_command',
      data: {
        command: origOp?.command || (origOp?.commands ? origOp.commands.join(' && ') : opResult.message || ''),
        output: opResult.message || '',
        exitCode: null,
        duration: 0,
        success: false,
      },
    });
  } else if (opResult.kind === 'get_tool_info') {
    unifiedResults.operations.push({
      toolKind: 'tool_info',
      data: { message: opResult.message, status: opResult.status },
    });
  } else {
    unifiedResults.operations.push({
      toolKind: opResult.kind,
      data: opResult,
    });
  }
}
    }

    if (unifiedResults.operations.length > 0) {
      this._lastExecutionResult = unifiedResults;
      this._unifiedResultsPanelManager?.openUnifiedResultsPanel(unifiedResults);
    }

    let combinedSuccess = true;
    const combinedErrors: string[] = [];

    if (queryResult) {
      combinedSuccess = combinedSuccess && queryResult.success;
      combinedErrors.push(...queryResult.errors.map(e => e.details));
    }

    if (fileResult) {
      combinedSuccess = combinedSuccess && fileResult.success;
      combinedErrors.push(...fileResult.errors.map(e => e.details));
    }

    let combinedOpResults: OperationResult[] = [];
    if (queryResult) combinedOpResults.push(...queryResult.operationResults);
    if (fileResult) combinedOpResults.push(...fileResult.operationResults);

    const pointerMsg = this._getChatStatusMessage({ success: combinedSuccess, operationResults: combinedOpResults, errors: combinedErrors });
    const command = combinedSuccess ? 'success' : 'error';
    const msg: ExtensionMessage = { command, message: pointerMsg };
    this._view?.webview.postMessage(msg);

    if (!combinedSuccess) {
      this._outputChannel.appendLine('=== EXECUTION SUMMARY ===');
      this._outputChannel.appendLine('Query result: ' + JSON.stringify(queryResult));
      this._outputChannel.appendLine('File result: ' + JSON.stringify(fileResult));
      this._outputChannel.show(true);
    }
  }

  private async _handleExtractStructure(text: string) {
    await this._closePreviewTabs();

    let operations;
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
    } catch (e) {
      if (e instanceof BrudError) {
        this._sendParseErrorToWebview(e);
      } else {
        this._sendParseErrorToWebview(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const extractOps = operations.filter(op => op.kind === 'extract_structure');
    if (extractOps.length === 0) {
      this._sendErrorToWebview(noExtractOperationsError());
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
      this._sendErrorToWebview(executionFailedError(result.message + (result.errors.length > 0 ? ' Errors: ' + result.errors.join('; ') : '')));
      return;
    }

    if (result.errors.length > 0) {
      this._outputChannel.appendLine('Extraction had errors: ' + result.errors.join('; '));
      this._sendErrorToWebview(executionFailedError(result.message + ' Errors: ' + result.errors.join('; ')));
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
    const pointerMsg: ExtensionMessage = { command: 'success', message: 'Successful. Check the report at the Report Panel.' };
    this._view?.webview.postMessage(pointerMsg);
    this._unifiedResultsPanelManager?.openUnifiedResultsPanel({
      operations: structureResults.map(s => ({
        toolKind: 'extractionResults',
        data: s,
      })),
    });
    this._outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
  }

  private _generateStructuredReport(result: { success: boolean; message: string; errors: string[]; operationResults: OperationResult[] }): ReportSection[] {
    const sections: ReportSection[] = [];
    const totalOps = result.operationResults.length;
    const successCount = result.operationResults.filter(r => r.status === 'success').length;
    const failedCount = result.operationResults.filter(r => r.status === 'failed').length;
    const abortedCount = result.operationResults.filter(r => r.status === 'aborted').length;
    const totalDuration = result.operationResults.reduce((sum, r) => {
      if (r.data) {
        const data = Array.isArray(r.data) ? r.data : [r.data];
        return sum + data.reduce((s, d) => s + (d.duration || 0), 0);
      }
      return sum;
    }, 0);

    sections.push({
      type: 'summary',
      title: 'Execution Summary',
      items: [
        { label: 'Total Operations', value: String(totalOps) },
        { label: 'Success', value: String(successCount), status: 'success' },
        { label: 'Failed', value: String(failedCount), status: 'failed' },
        { label: 'Aborted', value: String(abortedCount), status: 'aborted' },
        { label: 'Total Duration', value: `${totalDuration}ms` },
      ],
    });

    const tableItems = result.operationResults.map(r => {
      let duration = 0;
      if (r.data) {
        const data = Array.isArray(r.data) ? r.data : [r.data];
        duration = data.reduce((s, d) => s + (d.duration || 0), 0);
      }
      return {
        label: r.kind,
        value: `${r.path} — ${duration}ms`,
        status: r.status as 'success' | 'failed' | 'aborted',
      };
    });

    sections.push({
      type: 'table',
      title: 'Operation Breakdown',
      items: tableItems,
    });

    if (!result.success && result.errors.length > 0) {
      sections.push({
        type: 'details',
        title: 'Errors',
        content: result.errors.map(e => `- ${e}`).join('\n'),
      });
    }

    sections.push({
      type: 'button',
      buttonText: 'See Details',
      buttonAction: 'openUnifiedResults',
    });

    return sections;
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

  private _sendParseErrorToWebview(error: string | BrudError | ValidationResult): void {
    const structured = this._generateErrorReport(error);
    structured.push({ type: 'button', buttonText: 'Go to Prompt Library', buttonAction: 'openPromptLibrary' });

    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'I couldn\'t understand the format of your message.';
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
