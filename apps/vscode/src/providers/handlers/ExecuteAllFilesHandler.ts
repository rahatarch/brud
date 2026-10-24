import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import type { FileOperation, FileOperationResult, SessionMetadata, ChunkCallback } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { PanelManager } from '../services/PanelManager';
import { WorkspaceResolver } from '../services/WorkspaceResolver';
import { reportExecutionResult, transformTerminalOperationData, closePreviewTabs } from '../services/SharedExecutionHelpers';

export class ExecuteAllFilesHandler {
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
    private clearFileList: () => void,
    private clearOperationsByFile: () => void,
    private resetCurrentFileIndex: () => void,
    private getSessionMetadata: () => SessionMetadata | undefined,
  ) {}

  async handle(): Promise<void> {
    const runId = randomUUID();
    if (this.getOperationsByFile().size === 0) {
      const msg: ExtensionMessage = {
        command: 'error',
        message: 'No operations available to execute. Generate a preview first.',
      };
      this.getWebview()?.postMessage(msg);
      this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: false });
      return;
    }

    const allOperations: FileOperation[] = [];
    for (const ops of this.getOperationsByFile().values()) {
      allOperations.push(...ops);
    }

    if (allOperations.length === 0) {
      const msg: ExtensionMessage = {
        command: 'error',
        message: 'No operations available to execute. Generate a preview first.',
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

    const hasStreamingTerminal = allOperations.some((op) => op.kind === 'terminal_command');
    if (hasStreamingTerminal) {
      this.panelManager.showTerminalStream(runId);
    }
    this.panelManager.postDiffPreviewMessageIfOpen({ command: 'executionState', executing: true });

    let result: FileOperationResult;
    try {
      result = await this.executor.execute(
        allOperations,
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

      const terminalOps = transformTerminalOperationData(result.operationResults, allOperations);

      const unifiedOps: { toolKind: string; data: any }[] = [];
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
          const origOp = allOperations[op.operationIndex] as any;
          unifiedOps.push({
            toolKind: 'terminal_command',
            data: {
              command: origOp?.command || (origOp?.commands ? origOp.commands.join(' && ') : op.message || ''),
              output: op.details ? '' : (op.message || ''),
              exitCode: null,
              duration: 0,
              success: false,
              ...(op.code ? { code: op.code } : {}),
              ...(op.details ? { details: op.details } : {}),
              ...(op.status ? { status: op.status } : {}),
            },
          });
        }
      }

      if (unifiedOps.length > 0) {
        this.panelManager.showUnifiedResults({ operations: unifiedOps });
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
        command: 'executeSuccess',
        message: `Successfully applied ${this.getFileList().length} patches`,
      });
      await closePreviewTabs();
      this.clearFileList();
      this.clearOperationsByFile();
      this.resetCurrentFileIndex();
      this.setDiffPreviewSessionId(undefined);
      const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
      this.getWebview()?.postMessage(hideMsg);
    }
  }
}