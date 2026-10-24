import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { FileOperation, FileOperationResult, SessionMetadata, ChunkCallback } from '@brud/core';
import type { ExtensionMessage, UnifiedOperationResult, UnifiedSessionResults } from '@brud/protocol';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { PanelManager } from '../services/PanelManager';
import { WorkspaceResolver } from '../services/WorkspaceResolver';
import { reportExecutionResult, transformTerminalOperationData } from '../services/SharedExecutionHelpers';
import { buildFailedTerminalData } from '../services/TerminalDataAdapter';

export class ExecuteCurrentFileHandler {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private executor: ExecutionCoordinator,
    private workspace: WorkspaceResolver,
    private getFileList: () => string[],
    private getCurrentFileIndex: () => number,
    private getOperationsByFile: () => Map<string, FileOperation[]>,
    private getOriginalPrompt: () => string,
    private getDiffPreviewSessionId: () => string | undefined,
    private setDiffPreviewSessionId: (id: string | undefined) => void,
    private getWebview: () => vscode.Webview | undefined,
    private getLastExecutionResult: () => UnifiedSessionResults | null,
    private setLastExecutionResult: (val: UnifiedSessionResults | null) => void,
    private getSessionMetadata: () => SessionMetadata | undefined,
  ) {}

  async handle(fileIndex?: number): Promise<void> {
    const runId = randomUUID();
    const idx = fileIndex !== undefined ? fileIndex : this.getCurrentFileIndex();
    this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile called. fileIndex param=${fileIndex}, this._currentFileIndex=${this.getCurrentFileIndex()}, resolved idx=${idx}`);
    this.outputChannel.appendLine(`[DEBUG] _fileList contents: ${JSON.stringify(this.getFileList())}`);

    const fileList = this.getFileList();
    if (fileList.length === 0 || idx < 0 || idx >= fileList.length) {
      this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: returning early - invalid idx=${idx}, _fileList.length=${fileList.length}`);
      const msg: ExtensionMessage = {
        command: 'error',
        message: 'Unable to execute: no target file is available. Generate a preview first.',
      };
      this.getWebview()?.postMessage(msg);
      this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: false });
      return;
    }

    const filePath = fileList[idx];
    this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: selected filePath="${filePath}" at idx=${idx}`);
    const operations = this.getOperationsByFile().get(filePath) || [];

    if (operations.length === 0) {
      this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: returning early - no operations for "${filePath}"`);
      const msg: ExtensionMessage = {
        command: 'error',
        message: `No operations available for ${filePath}. Generate a preview first.`,
      };
      this.getWebview()?.postMessage(msg);
      this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: false });
      return;
    }

    const activeProcessIds = new Set<string>();

    const onChunk: ChunkCallback = (chunk: string, chunkIndex: number) => {
      const processIds = this.executor.getActiveProcessIds();
      const processId = processIds.length > 0 ? processIds[processIds.length - 1] : 'default';
      activeProcessIds.add(processId);
      const msg: ExtensionMessage = {
        command: 'terminalChunk',
        chunk,
        chunkIndex,
        processId,
      };
      this.getWebview()?.postMessage(msg);
      this.panelManager.postTerminalChunk(chunk, chunkIndex, processId);
    };

    const hasStreamingTerminal = operations.some((op) => op.kind === 'terminal_command');
    if (hasStreamingTerminal) {
      this.panelManager.showTerminalStream(runId);
    }
    this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: true });

    let result: FileOperationResult;
    try {
      result = await this.executor.execute(
        operations,
        this.getOriginalPrompt(),
        this.getDiffPreviewSessionId(),
        this.getSessionMetadata(),
        onChunk,
      );

      if (hasStreamingTerminal) {
        const liveIds = this.executor.getActiveProcessIds();
        for (const id of liveIds) {
          activeProcessIds.add(id);
        }
        const streamStatus = result?.success ? 'success' : 'failed';
        for (const processId of activeProcessIds) {
          this.panelManager.postStreamDone(processId, streamStatus);
        }
      }

      const readData = reportExecutionResult(this.outputChannel, this.getWebview, result);

      const terminalOps = transformTerminalOperationData(result.operationResults, operations);

      const unifiedOps: UnifiedOperationResult[] = [];
      if (readData) unifiedOps.push({ toolKind: 'readResults', data: readData });
      unifiedOps.push(...terminalOps);

      const READ_SUCCESS_KINDS = new Set(['read_file', 'read_files', 'read_directory']);

      for (const op of result.operationResults) {
        if (op.kind !== 'terminal_command' && !(READ_SUCCESS_KINDS.has(op.kind) && op.status === 'success')) {
          unifiedOps.push({ toolKind: op.kind, data: op });
        }
      }

      for (const op of result.operationResults) {
        if (op.kind === 'terminal_command' && !op.data) {
          const origOp = operations[op.operationIndex];
          unifiedOps.push({
            toolKind: 'terminal_command',
            data: buildFailedTerminalData(op, origOp),
          });
        }
      }

      if (unifiedOps.length > 0) {
        const existing = this.getLastExecutionResult();
        if (existing) {
          this.setLastExecutionResult({
            operations: [...existing.operations, ...unifiedOps],
          });
        } else {
          this.setLastExecutionResult({ operations: unifiedOps });
        }
      }
    } finally {
      if (hasStreamingTerminal) {
        this.panelManager.closeTerminalStreamPanel(runId);
      }
      this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: false });
    }

    if (result?.success) {
      if (result?.sessionId) {
        this.setDiffPreviewSessionId(result.sessionId);
      }

      this.panelManager.postDiffPreviewMessage({
        command: 'filePatched',
        fileIndex: idx,
      });
    }
  }
}