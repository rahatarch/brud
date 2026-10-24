import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { getWorkspaceFolders } from '@brud/vscode-adapter';
import { parseOperationsWithMetadata, cleanBrudInput, BrudError } from '@brud/core';
import type { FileOperation, FileOperationResult, SessionMetadata } from '@brud/core';
import type { ExtensionMessage, UnifiedSessionResults } from '@brud/protocol';
import { ErrorReporter } from '../services/ErrorReporter';
import { PanelManager } from '../services/PanelManager';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { closePreviewTabs, getChatStatusMessage, transformTerminalOperationData } from '../services/SharedExecutionHelpers';
import { buildFailedTerminalData } from '../services/TerminalDataAdapter';
import { parseStructuredExecutionMessage } from '../services/executionPayloads';

export class ApplyPatchHandler {
  private _lastExecutionResult: UnifiedSessionResults | null = null;

  constructor(
    private outputChannel: vscode.OutputChannel,
    private errorReporter: ErrorReporter,
    private panelManager: PanelManager,
    private executionCoordinator: ExecutionCoordinator,
    private getWebview: () => vscode.Webview | undefined,
    private getSetLastExecutionResult: () => UnifiedSessionResults | null,
    private setLastExecutionResult: (result: UnifiedSessionResults | null) => void,
    private setSessionMetadata: (m: SessionMetadata | undefined) => void,
  ) {}

  get lastExecutionResult(): UnifiedSessionResults | null {
    return this.getSetLastExecutionResult();
  }

  set lastExecutionResult(value: UnifiedSessionResults | null) {
    this.setLastExecutionResult(value);
  }

  async handle(text: string): Promise<void> {
    const runId = randomUUID();
    await closePreviewTabs();
    this.panelManager.closeDiffPreview();
    this.outputChannel.appendLine('DEBUG: Before parseOperations');

    let operations: FileOperation[];
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

    const unifiedResults: UnifiedSessionResults = { operations: [] };

    const activeProcessIds = new Set<string>();

    const onChunk = (chunk: string, chunkIndex: number) => {
      const processIds = this.executionCoordinator.getActiveProcessIds();
      const processId = processIds.length > 0 ? processIds[processIds.length - 1] : 'default';
      activeProcessIds.add(processId);
      const chunkMsg: ExtensionMessage = { command: 'terminalChunk', chunk, chunkIndex, processId };
      this.getWebview()?.postMessage(chunkMsg);
      this.panelManager.postTerminalChunk(chunk, chunkIndex, processId);
    };

    const hasStreamingTerminal = operations.some((op) => op.kind === 'terminal_command');
    if (hasStreamingTerminal) {
      this.panelManager.showTerminalStream(runId);
    }

    let executionResult: FileOperationResult;
    try {
      executionResult = await this.executionCoordinator.execute(operations, text, undefined, sessionMetadata, onChunk);

      if (hasStreamingTerminal) {
        const liveIds = this.executionCoordinator.getActiveProcessIds();
        for (const id of liveIds) {
          activeProcessIds.add(id);
        }
        const streamStatus = executionResult?.success ? 'success' : 'failed';
        for (const processId of activeProcessIds) {
          this.panelManager.postStreamDone(processId, streamStatus);
        }
      }
      this.outputChannel.appendLine('DEBUG: After executionCoordinator.execute - success: ' + executionResult?.success + ' - errors: ' + (executionResult?.errors?.length ?? 0));

      for (const err of executionResult?.errors ?? []) {
        this.outputChannel.appendLine(`  ERROR: ${err}`);
      }

      const parsedMessage = parseStructuredExecutionMessage(executionResult.message);

      for (const item of parsedMessage?.extractionResults ?? []) {
        unifiedResults.operations.push({ toolKind: 'extractionResults', data: item });
      }

      for (const item of parsedMessage?.readResults ?? []) {
        unifiedResults.operations.push({ toolKind: 'readResults', data: item });
      }

      for (const entry of parsedMessage?.searchResults ?? []) {
        unifiedResults.operations.push({ toolKind: 'search_files', data: entry.results });
      }

      if (parsedMessage?.codebaseMetadata) {
        unifiedResults.operations.push({
          toolKind: 'codebase_metadata',
          data: parsedMessage.codebaseMetadata,
        });
      }

      const READ_SUCCESS_KINDS = new Set(['read_file', 'read_files', 'read_directory', 'search_files', 'codebase_metadata']);

      for (const opResult of executionResult.operationResults) {
        if (opResult.kind === 'terminal_command' && opResult.data) {
          const items = transformTerminalOperationData([opResult], operations);
          unifiedResults.operations.push(...items);
        } else if (opResult.kind === 'terminal_command' && !opResult.data) {
          const origOp = operations[opResult.operationIndex];
          unifiedResults.operations.push({
            toolKind: 'terminal_command',
            data: buildFailedTerminalData(opResult, origOp),
          });
        } else if (opResult.kind === 'get_tool_info') {
          unifiedResults.operations.push({
            toolKind: 'tool_info',
            data: {
              message: opResult.message,
              status: opResult.status,
              toolKind: (() => {
                const originalOperation = operations[opResult.operationIndex];
                return originalOperation && 'toolKind' in originalOperation ? originalOperation.toolKind : undefined;
              })(),
              ...(opResult.code ? { code: opResult.code } : {}),
              ...(opResult.details ? { details: opResult.details } : {}),
            },
          });
        } else if (!(READ_SUCCESS_KINDS.has(opResult.kind) && opResult.status === 'success')) {
          unifiedResults.operations.push({
            toolKind: opResult.kind,
            data: opResult,
          });
        }
      }

      if (unifiedResults.operations.length > 0) {
        this.lastExecutionResult = unifiedResults;
        this.panelManager.showUnifiedResults(unifiedResults);
      }
    } finally {
      if (hasStreamingTerminal) {
        this.panelManager.closeTerminalStreamPanel(runId);
      }
    }

    const pointerMsg = getChatStatusMessage({
      success: executionResult?.success ?? false,
      operationResults: executionResult?.operationResults ?? [],
      errors: executionResult?.errors ?? [],
    });
    const command = executionResult?.success ? 'success' : 'error';
    const msg: ExtensionMessage = { command, message: pointerMsg };
    this.getWebview()?.postMessage(msg);

    if (!executionResult?.success) {
      this.outputChannel.appendLine('=== EXECUTION SUMMARY ===');
      this.outputChannel.appendLine('Execution result: ' + JSON.stringify(executionResult));
      this.outputChannel.show(true);
    }
  }
}