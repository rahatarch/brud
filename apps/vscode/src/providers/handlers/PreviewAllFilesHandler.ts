import * as vscode from 'vscode';
import { BrudAPI } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import { getWorkspaceFolders } from '@brud/vscode-adapter';
import type { FileOperation, PatchBlock } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { BrudCodePreviewProvider } from '../DiffPreviewProvider';

export class PreviewAllFilesHandler {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private getFileList: () => string[],
    private getOperationsByFile: () => Map<string, FileOperation[]>,
    private previewProvider: BrudCodePreviewProvider,
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  async handle(): Promise<void> {
    const fileList = this.getFileList();
    if (fileList.length === 0) {
      return;
    }

    const combinedParts: string[] = [];

    for (const filePath of fileList) {
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

      const operations = this.getOperationsByFile().get(filePath) || [];
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
        this.outputChannel.appendLine(`WARNING: ${msg}`);
        if (block) {
          this.outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
        }
      });

      if (!matches) {
        continue;
      }

      const previewContent = reconstructContent(docLines, matches);
      combinedParts.push(`// === ${filePath} ===\n${previewContent}`);
    }

    if (combinedParts.length === 0) {
      const msg: ExtensionMessage = { command: 'error', message: 'No preview available.' };
      this.getWebview()?.postMessage(msg);
      return;
    }

    const combinedContent = combinedParts.join('\n\n');
    const firstFileResult = BrudAPI.validate.path(fileList[0], getWorkspaceFolders());
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
    this.previewProvider.setContent(previewUri, combinedContent);

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
      totalFiles: fileList.length,
    };
    this.getWebview()?.postMessage(headerMsg);
  }
}