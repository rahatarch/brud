import * as vscode from 'vscode';
import type { FileOperation, FileOperationResult, OperationResult } from '@brud/core';
import type { ExtensionMessage, ReadResultData } from '@brud/protocol';
import { ExecutionCoordinator } from '../services/ExecutionCoordinator';
import { PanelManager } from '../services/PanelManager';
import { WorkspaceResolver } from '../services/WorkspaceResolver';

function _getChatStatusMessage(result: { success: boolean; operationResults?: any[]; errors?: any[] }): string {
  if (result.success && (!result.errors || result.errors.length === 0)) {
    return 'Successful. Check the report at the Report Panel.';
  }

  if (result.operationResults && result.operationResults.length > 0) {
    const successCount = result.operationResults.filter(r => r.status === 'success').length;
    if (successCount > 0) {
      return 'Partially succeeded. Please check the report at the Report Panel.';
    }
  }

  return 'Failed. Check the report at the Report Panel.';
}

function _reportExecutionResult(
  outputChannel: vscode.OutputChannel,
  getWebview: () => vscode.Webview | undefined,
  result: { success: boolean; message: string; errors: any[]; operationResults: OperationResult[] },
): ReadResultData | null {
  outputChannel.appendLine(result.message);
  for (const err of result.errors) {
    outputChannel.appendLine(`  ERROR: ${err.details}`);
  }

  if (result.success) {
    let readData: any;
    try {
      readData = JSON.parse(result.message);
    } catch {
      readData = null;
    }

    const isReadResult = readData && (readData.totalFiles !== undefined || (Array.isArray(readData) && readData.some((d: any) => d.totalFiles !== undefined)));

    if (isReadResult) {
      const readResultData: ReadResultData = Array.isArray(readData)
        ? readData.reduce((merged: ReadResultData, d: any) => ({
            files: [...(merged.files || []), ...(d.files || [])],
            totalFiles: merged.totalFiles + (d.totalFiles || 0),
            totalSize: merged.totalSize + (d.totalSize || 0),
          }), { files: [], totalFiles: 0, totalSize: 0 })
        : readData;
      return readResultData;
    }
  }

  const pointerMsg = _getChatStatusMessage(result);
  const command = result.success ? 'success' : 'error';
  const msg: ExtensionMessage = { command, message: pointerMsg };
  getWebview()?.postMessage(msg);

  if (!result.success) {
    outputChannel.show(true);
  }

  return null;
}

function _toTerminalOperationData(
  operationResults: OperationResult[],
  originalOperations: FileOperation[],
): { toolKind: 'terminal_command'; data: any }[] {
  const result: { toolKind: 'terminal_command'; data: any }[] = [];
  for (const op of operationResults) {
    if (op.kind !== 'terminal_command' || !op.data) continue;
    if (Array.isArray(op.data)) {
      const originalOp = originalOperations[op.operationIndex] as any;
      let mode: 'single' | 'sequential' | 'parallel' | 'conditional' = 'sequential';
      if (originalOp) {
        if (originalOp.mode === 'parallel') {
          mode = 'parallel';
        } else if (originalOp.onSuccess || originalOp.onFailure) {
          mode = 'conditional';
        } else {
          mode = 'sequential';
        }
      }
      const succeeded = op.data.filter((d: any) => d.success).length;
      const failed = op.data.filter((d: any) => !d.success).length;
      const totalDuration = op.data.reduce((sum: number, d: any) => sum + (d.duration || 0), 0);
      result.push({
        toolKind: 'terminal_command',
        data: {
          mode,
          results: op.data,
          totalDuration,
          succeeded,
          failed,
        },
      });
    } else {
      result.push({ toolKind: 'terminal_command', data: op.data });
    }
  }
  return result;
}

async function _closePreviewTabs(): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
  for (const tab of tabs) {
    if (tab.input instanceof vscode.TabInputTextDiff) {
      if (tab.input.modified.scheme === 'brud-preview') {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }
  await new Promise(resolve => (globalThis as any).setTimeout(resolve, 100));
}

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
    const readData = _reportExecutionResult(this.outputChannel, this.getWebview, result);

    const terminalOps = _toTerminalOperationData(result.operationResults, allOperations);

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
      await _closePreviewTabs();
      this.clearFileList();
      this.clearOperationsByFile();
      this.resetCurrentFileIndex();
      this.setDiffPreviewSessionId(undefined);
      const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
      this.getWebview()?.postMessage(hideMsg);
    }
  }
}