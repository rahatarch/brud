import * as vscode from 'vscode';
import { parseOperations, cleanBrudInput, BrudError } from '@brud/core';
import { getWorkspaceFolders } from '@brud/vscode-adapter';
import { BrudAPI } from '@brud/core';
import { findMatches, reconstructContent } from '@brud/core';
import type { FileOperation, PatchBlock } from '@brud/core';
import type { DiffFileEntry, DiffPreviewData, ExtensionMessage, ReportSection } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';
import { ErrorReporter } from '../services/ErrorReporter';

function groupOperationsByFile(operations: FileOperation[]): Map<string, FileOperation[]> {
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

export class PreviewPatchHandler {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private errorReporter: ErrorReporter,
    private panelManager: PanelManager,
    private getWebview: () => vscode.Webview | undefined,
    private setOriginalPrompt: (val: string) => void,
    private setOperationsByFile: (map: Map<string, FileOperation[]>) => void,
    private setFileList: (list: string[]) => void,
    private setCurrentFileIndex: (idx: number) => void,
    private getFileList: () => string[],
  ) {}

  async handle(text: string): Promise<void> {
    this.setOriginalPrompt(text);
    let operations: FileOperation[];
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
    } catch (e) {
      if (e instanceof BrudError) {
        this.errorReporter.sendParseError(e);
      } else {
        this.errorReporter.sendParseError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const opsByFile = groupOperationsByFile(operations);
    this.setOperationsByFile(opsByFile);
    const fileList = Array.from(opsByFile.keys());
    this.setFileList(fileList);
    this.setCurrentFileIndex(0);

    if (fileList.length === 0) {
      this.errorReporter.sendError('No valid operations found.');
      return;
    }

    const previewableKinds = new Set(['search_replace', 'create_file', 'append_file']);
    const hasPreviewableOps = operations.some(op => previewableKinds.has(op.kind));

    if (!hasPreviewableOps) {
      this.panelManager.showNoPreview();
      return;
    }

    const diffFiles: DiffFileEntry[] = [];

    for (const filePath of fileList) {
      const result = BrudAPI.validate.path(filePath, getWorkspaceFolders());
      const fileOps = opsByFile.get(filePath) || [];
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
          this.outputChannel.appendLine(`WARNING: ${msg}`);
          if (block) {
            this.outputChannel.appendLine(`--- FAILED BLOCK [${block.index}] ---`);
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
      this.getWebview()?.postMessage(msg);
      this.panelManager.showNoPreview('No changes found. The search text was not found in any of the files.');
      return;
    }

    const diffPreviewData: DiffPreviewData = {
      files: diffFiles,
      currentIndex: 0,
    };

    this.panelManager.showDiffPreview(diffPreviewData);

    const showMsg: ExtensionMessage = { command: 'showPreviewNavigation' };
    this.getWebview()?.postMessage(showMsg);
  }
}