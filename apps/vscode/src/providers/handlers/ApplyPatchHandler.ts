import * as vscode from 'vscode';
import { executeFileOperations, getWorkspaceFolders, VSCodeFileSystem, WorkspaceHistoryStore } from '@brud/vscode-adapter';
import { executeOperationsFromVSCode } from '@brud/vscode-adapter';
import { parseOperations, cleanBrudInput, BrudError } from '@brud/core';
import type { FileOperation, OperationResult } from '@brud/protocol';
import type { ExtensionMessage } from '@brud/protocol';
import { ErrorReporter } from '../services/ErrorReporter';
import { PanelManager } from '../services/PanelManager';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { closePreviewTabs, getChatStatusMessage, transformTerminalOperationData } from '../services/SharedExecutionHelpers';
import { buildFailedTerminalData } from '../services/TerminalDataAdapter';

export class ApplyPatchHandler {
  private _lastExecutionResult: { operations: { toolKind: string; data: any }[] } | null = null;

  constructor(
    private outputChannel: vscode.OutputChannel,
    private errorReporter: ErrorReporter,
    private panelManager: PanelManager,
    private executionCoordinator: ExecutionCoordinator,
    private getWebview: () => vscode.Webview | undefined,
    private getSetLastExecutionResult: () => { operations: { toolKind: string; data: any }[] } | null,
    private setLastExecutionResult: (result: { operations: { toolKind: string; data: any }[] } | null) => void,
  ) {}

  get lastExecutionResult(): { operations: { toolKind: string; data: any }[] } | null {
    return this.getSetLastExecutionResult();
  }

  set lastExecutionResult(value: { operations: { toolKind: string; data: any }[] } | null) {
    this.setLastExecutionResult(value);
  }

  async handle(text: string): Promise<void> {
    await closePreviewTabs();
    this.panelManager.closeDiffPreview();
    this.outputChannel.appendLine('DEBUG: Before parseOperations');

    let operations: any[];
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
      this.outputChannel.appendLine('DEBUG: After parseOperations - operations count: ' + operations.length);
    } catch (e) {
      this.outputChannel.appendLine('DEBUG: parseOperations threw: ' + (e instanceof Error ? e.message : String(e)));
      if (e instanceof BrudError) {
        this.errorReporter.sendParseError(e);
      } else {
        this.errorReporter.sendParseError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const queryOps = operations.filter((op: any) =>
      op.kind === 'extract_structure' ||
      op.kind === 'read_file' || op.kind === 'read_files' || op.kind === 'read_directory' ||
      op.kind === 'search_files' ||
      op.kind === 'codebase_metadata'
    );

    const fileOps = operations.filter((op: any) =>
      op.kind !== 'extract_structure' &&
      op.kind !== 'read_file' && op.kind !== 'read_files' && op.kind !== 'read_directory' &&
      op.kind !== 'search_files' &&
      op.kind !== 'codebase_metadata'
    );

    let queryResult: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] } | null = null;
    let fileResult: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] } | null = null;
    const unifiedResults: { operations: { toolKind: string; data: any }[] } = { operations: [] };

    if (queryOps.length > 0) {
      this.outputChannel.appendLine('DEBUG: Before executeFileOperations for query operations');
      queryResult = await executeFileOperations(queryOps, new VSCodeFileSystem(), getWorkspaceFolders());
      this.outputChannel.appendLine('DEBUG: After executeFileOperations - success: ' + queryResult.success + ' - errors: ' + queryResult.errors.length);

      for (const err of queryResult.errors) {
        this.outputChannel.appendLine(`  ERROR: ${err}`);
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
          const items = transformTerminalOperationData([opResult] as any, fileOps);
          unifiedResults.operations.push(...items);
        } else if (opResult.kind === 'terminal_command' && !opResult.data) {
          const origOp = fileOps[opResult.operationIndex] as any;
          unifiedResults.operations.push({
            toolKind: 'terminal_command',
            data: buildFailedTerminalData(opResult, origOp),
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
      this.lastExecutionResult = unifiedResults;
      this.panelManager.showUnifiedResults(unifiedResults);
    }

    let combinedSuccess = true;
    const combinedErrors: string[] = [];

    if (queryResult) {
      combinedSuccess = combinedSuccess && queryResult.success;
      combinedErrors.push(...queryResult.errors.map((e: any) => e.details));
    }

    if (fileResult) {
      combinedSuccess = combinedSuccess && fileResult.success;
      combinedErrors.push(...fileResult.errors.map((e: any) => e.details));
    }

    let combinedOpResults: any[] = [];
    if (queryResult) combinedOpResults.push(...queryResult.operationResults);
    if (fileResult) combinedOpResults.push(...fileResult.operationResults);

    const pointerMsg = getChatStatusMessage({ success: combinedSuccess, operationResults: combinedOpResults, errors: combinedErrors });
    const command = combinedSuccess ? 'success' : 'error';
    const msg: ExtensionMessage = { command, message: pointerMsg };
    this.getWebview()?.postMessage(msg);

    if (!combinedSuccess) {
      this.outputChannel.appendLine('=== EXECUTION SUMMARY ===');
      this.outputChannel.appendLine('Query result: ' + JSON.stringify(queryResult));
      this.outputChannel.appendLine('File result: ' + JSON.stringify(fileResult));
      this.outputChannel.show(true);
    }
  }
}