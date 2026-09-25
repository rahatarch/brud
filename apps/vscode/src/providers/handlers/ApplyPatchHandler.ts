import * as vscode from 'vscode';
import { getWorkspaceFolders } from '@brud/vscode-adapter';
import { parseOperationsWithMetadata, cleanBrudInput, BrudError, packageOperationResults, READ_SUCCESS_KINDS, getChatStatusMessage } from '@brud/core';
import type { FileOperation, OperationResult, SessionMetadata } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { ErrorReporter } from '../services/ErrorReporter';
import { PanelManager } from '../services/PanelManager';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { closePreviewTabs } from '../services/SharedExecutionHelpers';

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
    private setSessionMetadata: (m: SessionMetadata | undefined) => void,
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
    let sessionMetadata: SessionMetadata | undefined;
    try {
      const parsed = parseOperationsWithMetadata(cleanBrudInput(text), getWorkspaceFolders());
      operations = parsed.operations;
      sessionMetadata = parsed.sessionMetadata;
      this.setSessionMetadata(sessionMetadata);
      this.outputChannel.appendLine('DEBUG: After parseOperationsWithMetadata - operations count: ' + operations.length);
    } catch (e) {
      this.outputChannel.appendLine('DEBUG: parseOperationsWithMetadata threw: ' + (e instanceof Error ? e.message : String(e)));
      if (e instanceof BrudError) {
        this.errorReporter.sendParseError(e);
      } else {
        this.errorReporter.sendParseError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const unifiedResults: { operations: { toolKind: string; data: any }[] } = { operations: [] };

    const executionResult = await this.executionCoordinator.execute(operations, text, undefined, sessionMetadata);
    this.outputChannel.appendLine('DEBUG: After executionCoordinator.execute - success: ' + executionResult.success + ' - errors: ' + executionResult.errors.length);

    for (const err of executionResult.errors) {
      this.outputChannel.appendLine(`  ERROR: ${err}`);
    }

    let parsedMessage: any;
    try {
      parsedMessage = JSON.parse(executionResult.message);
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

    const packaged = packageOperationResults(executionResult.operationResults, operations);
    for (const op of packaged.operations) {
      if (READ_SUCCESS_KINDS.has(op.kind) && op.success) {
        continue;
      }
      unifiedResults.operations.push({
        toolKind: op.kind === 'get_tool_info' ? 'tool_info' : op.kind,
        data: op.details ?? { message: op.message, filePath: op.filePath, success: op.success },
      });
    }

    if (unifiedResults.operations.length > 0) {
      this.lastExecutionResult = unifiedResults;
      this.panelManager.showUnifiedResults(unifiedResults);
    }

    const pointerMsg = getChatStatusMessage({ success: executionResult.success, operationResults: executionResult.operationResults, errors: executionResult.errors });
    const command = executionResult.success ? 'success' : 'error';
    const msg: ExtensionMessage = { command, message: pointerMsg };
    this.getWebview()?.postMessage(msg);

    if (!executionResult.success) {
      this.outputChannel.appendLine('=== EXECUTION SUMMARY ===');
      this.outputChannel.appendLine('Execution result: ' + JSON.stringify(executionResult));
      this.outputChannel.show(true);
    }
  }
}