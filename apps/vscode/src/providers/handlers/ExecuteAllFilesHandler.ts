import * as vscode from 'vscode';
import type { FileOperation, FileOperationResult, SessionMetadata } from '@brud/core';
import { packageOperationResults, READ_SUCCESS_KINDS } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { PanelManager } from '../services/PanelManager';
import { WorkspaceResolver } from '../services/WorkspaceResolver';
import { reportExecutionResult, closePreviewTabs } from '../services/SharedExecutionHelpers';

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
      this.getSessionMetadata(),
    );
    const readData = reportExecutionResult(this.outputChannel, this.getWebview, result);

    const packaged = packageOperationResults(result.operationResults, allOperations);

    const unifiedOps: { toolKind: string; data: any }[] = [];
    if (readData) unifiedOps.push({ toolKind: 'readResults', data: readData });

    for (const op of packaged.operations) {
      if (READ_SUCCESS_KINDS.has(op.kind) && op.success) {
        continue;
      }
      unifiedOps.push({
        toolKind: op.kind === 'get_tool_info' ? 'tool_info' : op.kind,
        data: op.details ?? { message: op.message, filePath: op.filePath, success: op.success },
      });
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