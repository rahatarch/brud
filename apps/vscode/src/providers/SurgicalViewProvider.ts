import * as vscode from 'vscode';
import * as fs from 'fs';
import { parseOperations } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { executeOperationsFromVSCode, getWorkspaceFolders, VSCodeFileSystem, WorkspaceHistoryStore } from '@brud/vscode-adapter';
import { BrudCodePreviewProvider } from './DiffPreviewProvider';
import { validateWorkspacePath } from '@brud/core';
import { PatchBlock, FileOperation } from '@brud/core';
import { extractDirectoryStructure } from '@brud/core';
import type { WebviewMessage, ExtensionMessage, ExecutionResult, StructureResult, CodebaseMetadataResult } from '@brud/protocol';

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

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _outputChannel: vscode.OutputChannel,
    private readonly _previewProvider: BrudCodePreviewProvider,
    mainWindowProvider?: any,
    structurePanelManager?: any,
  ) {
    this._mainWindowProvider = mainWindowProvider;
    this._structurePanelManager = structurePanelManager;
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
        : op.path;
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
          await this._handleExecuteCurrentFile();
          break;
        case 'executeAllFiles':
          await this._handleExecuteAllFiles();
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

  private async _handleExecuteCurrentFile() {
    if (this._fileList.length === 0 || this._currentFileIndex < 0 || this._currentFileIndex >= this._fileList.length) {
      return;
    }

    const filePath = this._fileList[this._currentFileIndex];
    const operations = this._operationsByFile.get(filePath) || [];
    const result = await executeFileOperations(operations, new VSCodeFileSystem(), getWorkspaceFolders());
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

    const result = await executeFileOperations(allOperations, new VSCodeFileSystem(), getWorkspaceFolders());
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
      this._outputChannel.show(true);
    } else {
      const msg: ExtensionMessage = { command: 'error', message: result.message + ' Errors: ' + result.errors.join('; ') };
      this._view?.webview.postMessage(msg);
      this._outputChannel.show(true);
    }
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

    const extractOps = operations.filter(op => op.kind === 'extract_structure');
    if (extractOps.length > 0) {
      this._outputChannel.appendLine('DEBUG: Before executeFileOperations for extract_structure');
      const result = await executeFileOperations(extractOps, new VSCodeFileSystem(), getWorkspaceFolders());
      this._outputChannel.appendLine('DEBUG: After executeFileOperations - success: ' + result.success + ' - errors: ' + result.errors.length);
      if (result.success) {
        let parsedStructures: any[];
        try {
          parsedStructures = JSON.parse(result.message);
        } catch {
          parsedStructures = [];
        }
        const structureResults: StructureResult[] = parsedStructures.map((item: any) => ({
          json: item.json,
          directoryPath: item.directoryPath,
          depth: item.depth,
          fileCount: item.fileCount,
          directoryCount: item.directoryCount,
        }));
        const structureNames = structureResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
        const successMsg: ExtensionMessage = { command: 'success', message: `Extracted directory structure${extractOps.length > 1 ? 's' : ''} from ${structureNames}. Results available in the Structure panel.` };
        this._view?.webview.postMessage(successMsg);
        this._structurePanelManager?.openStructurePanel(structureResults.length === 1 ? structureResults[0] : structureResults);
        this._outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
      } else {
        this._outputChannel.appendLine('=== EXECUTION FAILURE ===');
        this._outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
        this._outputChannel.appendLine('Result: ' + JSON.stringify(result));
        this._outputChannel.appendLine('DirectoryPath: ' + (extractOps[0] as any).directoryPath);
        this._outputChannel.appendLine('Depth: ' + (extractOps[0] as any).depth);
        this._outputChannel.show(true);
const errMsg: ExtensionMessage = { command: 'error', message: result.message + (result.errors.length > 0 ? ' Errors: ' + result.errors.join('; ') : '') };
        this._view?.webview.postMessage(errMsg);
      }
      return;
    }

    const metadataOps = operations.filter(op => op.kind === 'codebase_metadata');
    if (metadataOps.length > 0) {
      this._outputChannel.appendLine('DEBUG: Before executeFileOperations for codebase_metadata');
      const result = await executeFileOperations(metadataOps, new VSCodeFileSystem(), getWorkspaceFolders());
      this._outputChannel.appendLine('DEBUG: After executeFileOperations - success: ' + result.success + ' - errors: ' + result.errors.length);
      if (result.success) {
        let metadata: CodebaseMetadataResult;
        try {
          metadata = JSON.parse(result.message);
        } catch {
          const errMsg: ExtensionMessage = { command: 'error', message: 'Failed to parse codebase metadata result.' };
          this._view?.webview.postMessage(errMsg);
          return;
        }
        const report = `Analyzed codebase metadata: ${metadata.root} contains ${metadata.totalFiles} files in ${metadata.totalFolders} folders. Most dense folder: ${metadata.mostDenseFolder} with ${metadata.mostDenseCount} files.`;
        const successMsg: ExtensionMessage = { command: 'success', message: report };
        this._view?.webview.postMessage(successMsg);
        this._structurePanelManager?.openStructurePanel(metadata);
        this._outputChannel.appendLine(`Codebase metadata: ${JSON.stringify(metadata)}`);
      } else {
        this._outputChannel.appendLine('=== EXECUTION FAILURE ===');
        this._outputChannel.appendLine('Operations: ' + JSON.stringify(metadataOps));
        this._outputChannel.appendLine('Result: ' + JSON.stringify(result));
        this._outputChannel.show(true);
        const errMsg: ExtensionMessage = { command: 'error', message: result.message + (result.errors.length > 0 ? ' Errors: ' + result.errors.join('; ') : '') };
        this._view?.webview.postMessage(errMsg);
      }
      return;
    }

    const folders = getWorkspaceFolders();
    const historyStore = folders.length > 0 ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem()) : undefined;
    const result = await executeOperationsFromVSCode(operations, historyStore, text);
    const report = this._generateReport(operations, result);

    this._outputChannel.appendLine(result.message);
    for (const err of result.errors) {
      this._outputChannel.appendLine(`  ERROR: ${err}`);
    }

    if (result.success && result.errors.length === 0) {
      const msg: ExtensionMessage = { command: 'success', message: report };
      this._view?.webview.postMessage(msg);
    } else {
      this._outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this._outputChannel.appendLine('Operations: ' + JSON.stringify(operations));
      this._outputChannel.appendLine('Result: ' + JSON.stringify(result));
      this._outputChannel.show(true);
      const msg: ExtensionMessage = { command: 'error', message: report };
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
    if (result.success) {
      let parsedStructures: any[];
      try {
        parsedStructures = JSON.parse(result.message);
      } catch {
        parsedStructures = [];
      }
      const structureResults: StructureResult[] = parsedStructures.map((item: any) => ({
        json: item.json,
        directoryPath: item.directoryPath,
        depth: item.depth,
        fileCount: item.fileCount,
        directoryCount: item.directoryCount,
      }));
      const structureNames = structureResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
      const successMsg: ExtensionMessage = { command: 'success', message: `Extracted directory structure${extractOps.length > 1 ? 's' : ''} from ${structureNames}. Results available in the Structure panel.` };
      this._view?.webview.postMessage(successMsg);
      this._structurePanelManager?.openStructurePanel(structureResults.length === 1 ? structureResults[0] : structureResults);
      this._outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
    } else {
      this._outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this._outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
      this._outputChannel.appendLine('Result: ' + JSON.stringify(result));
      this._outputChannel.appendLine('DirectoryPath: ' + (extractOps[0] as any).directoryPath);
      this._outputChannel.appendLine('Depth: ' + (extractOps[0] as any).depth);
      this._outputChannel.show(true);
      const errMsg: ExtensionMessage = { command: 'error', message: result.message };
      this._view?.webview.postMessage(errMsg);
    }
  }

  private _generateReport(
    operations: FileOperation[],
    result: { success: boolean; message: string; errors: string[] }
  ): string {
    const lines: string[] = [];

    for (const op of operations) {
      switch (op.kind) {
        case 'search_replace':
          lines.push(`Patched ${op.path} by replacing the specified content.`);
          break;
        case 'create_file':
          lines.push(`Created ${op.path}.`);
          break;
        case 'delete_file':
          lines.push(`Deleted ${op.path}.`);
          break;
        case 'rename_file':
          lines.push(`Renamed ${op.from} to ${op.to}.`);
          break;
        case 'move_file':
          lines.push(`Moved ${op.from} to ${op.to}.`);
          break;
        case 'copy_file':
          lines.push(`Copied ${op.from} to ${op.to}.`);
          break;
        case 'append_file':
          lines.push(`Appended content to ${op.path}.`);
          break;
        case 'create_directory':
          lines.push(`Created directory ${op.directoryPath} with ${op.files.length} empty files.`);
          break;
        case 'delete_directory':
          lines.push(`Deleted directory ${op.directoryPath} and all its contents.`);
          break;
        case 'move_directory':
          lines.push(`Moved directory ${op.from} to ${op.to}.`);
          break;
        case 'extract_structure':
          lines.push(`Extracted directory structure of ${op.directoryPath} at depth ${op.depth}.`);
          break;
        case 'codebase_metadata':
          lines.push(`Analyzed codebase metadata: [root] contains [totalFiles] files in [totalFolders] folders. Most dense folder: [mostDenseFolder] with [mostDenseCount] files.`);
          break;
      }
    }

    let prefix: string;
    if (result.success && result.errors.length === 0) {
      prefix = 'All operations completed successfully.';
    } else if (result.success) {
      prefix = 'Some operations completed with errors.';
    } else {
      prefix = 'All operations failed.';
    }

    const report = [prefix, ...lines].join('\n');

    if (result.errors.length > 0) {
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
