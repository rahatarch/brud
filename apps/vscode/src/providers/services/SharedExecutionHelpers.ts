import * as vscode from 'vscode';
import type { FileOperation } from '@brud/core';
import type { ExtensionMessage, OperationResult, ReadResultData } from '@brud/protocol';
import { transformTerminalOperation } from './TerminalDataAdapter';

export function getChatStatusMessage(
  result: { success: boolean; operationResults?: any[]; errors?: any[] },
): string {
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

export function reportExecutionResult(
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

  const pointerMsg = getChatStatusMessage(result);
  const command = result.success ? 'success' : 'error';
  const msg: ExtensionMessage = { command, message: pointerMsg };
  getWebview()?.postMessage(msg);

  if (!result.success) {
    outputChannel.show(true);
  }

  return null;
}

export function transformTerminalOperationData(
  operationResults: OperationResult[],
  originalOperations: FileOperation[],
): { toolKind: 'terminal_command'; data: any }[] {
  const result: { toolKind: 'terminal_command'; data: any }[] = [];
  for (const op of operationResults) {
    const transformed = transformTerminalOperation(op, originalOperations);
    if (transformed) {
      result.push({ toolKind: 'terminal_command', data: transformed });
    }
  }
  return result;
}

export async function closePreviewTabs(): Promise<void> {
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