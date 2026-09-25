import * as vscode from 'vscode';
import type { FileOperation, FileOperationResult, SessionMetadata } from '@brud/core';
import { packageOperationResults, READ_SUCCESS_KINDS } from '@brud/core';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { PanelManager } from '../services/PanelManager';
import { WorkspaceResolver } from '../services/WorkspaceResolver';
import { reportExecutionResult } from '../services/SharedExecutionHelpers';

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
    private getLastExecutionResult: () => { operations: { toolKind: string; data: any }[] } | null,
    private setLastExecutionResult: (val: { operations: { toolKind: string; data: any }[] } | null) => void,
    private getSessionMetadata: () => SessionMetadata | undefined,
  ) {}

  async handle(fileIndex?: number): Promise<void> {
    const idx = fileIndex !== undefined ? fileIndex : this.getCurrentFileIndex();
    this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile called. fileIndex param=${fileIndex}, this._currentFileIndex=${this.getCurrentFileIndex()}, resolved idx=${idx}`);
    this.outputChannel.appendLine(`[DEBUG] _fileList contents: ${JSON.stringify(this.getFileList())}`);

    const fileList = this.getFileList();
    if (fileList.length === 0 || idx < 0 || idx >= fileList.length) {
      this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: returning early - invalid idx=${idx}, _fileList.length=${fileList.length}`);
      return;
    }

    const filePath = fileList[idx];
    this.outputChannel.appendLine(`[DEBUG] _handleExecuteCurrentFile: selected filePath="${filePath}" at idx=${idx}`);
    const operations = this.getOperationsByFile().get(filePath) || [];
    const result: FileOperationResult = await this.executor.execute(
      operations,
      this.getOriginalPrompt(),
      this.getDiffPreviewSessionId(),
      this.getSessionMetadata(),
    );
    const readData = reportExecutionResult(this.outputChannel, this.getWebview, result);

    const packaged = packageOperationResults(result.operationResults, operations);

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
      const existing = this.getLastExecutionResult();
      if (existing) {
        this.setLastExecutionResult({
          operations: [...existing.operations, ...unifiedOps],
        });
      } else {
        this.setLastExecutionResult({ operations: unifiedOps });
      }
    }

    if (result.success) {
      if (result.sessionId) {
        this.setDiffPreviewSessionId(result.sessionId);
      }

      this.panelManager.postDiffPreviewMessage({
        command: 'filePatched',
        fileIndex: idx,
      });
    }
  }
}