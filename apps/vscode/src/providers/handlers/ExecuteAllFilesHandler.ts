import * as vscode from 'vscode';
import type { FileOperation, FileOperationResult } from '@brud/core';
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
  ) {}

  async handle(): Promise<void> {
    if (this.getOperationsByFile().size === 0) {
      return;
    }

    const allOperations: FileOperation[] = [];
    for (const ops of this.getOperationsByFile().values()) {
      allOperations.push(...ops);
    }

    const result: FileOperationResult = await this.executor.execute(
      allOperations,
      this.getOriginalPrompt(),
      this.getDiffPreviewSessionId(),
    );
    const readData = reportExecutionResult(this.outputChannel, this.getWebview, result);

    const terminalOps = transformTerminalOperationData(result.operationResults, allOperations);

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
      this.panelManager.showUnifiedResults({ operations: unifiedOps });
    }

    if (result.success) {
      if (result.sessionId) {
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