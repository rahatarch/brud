import * as vscode from 'vscode';
import type { FileOperation } from '@brud/core';
import type { ExtensionMessage, OperationResult, ReadResultData } from '@brud/protocol';
import { transformTerminalOperation } from './TerminalDataAdapter';
import type { TerminalGroupData, TerminalResultData } from './TerminalDataAdapter';

interface ExecutionErrorLike {
  friendly: string;
  details: string;
}

interface ExecutionStatusInput {
  success: boolean;
  operationResults?: OperationResult[];
  errors?: Array<string | ExecutionErrorLike>;
}

interface ExecutionReportInput {
  success: boolean;
  message: string;
  errors: ExecutionErrorLike[];
  operationResults: OperationResult[];
}

interface SerializedReadResult {
  files: ReadResultData['files'];
  totalFiles: number;
  totalSize: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isSerializedReadResult(value: unknown): value is SerializedReadResult {
  return isRecord(value)
    && Array.isArray(value.files)
    && typeof value.totalFiles === 'number'
    && typeof value.totalSize === 'number';
}

export function getChatStatusMessage(result: ExecutionStatusInput): string {
  if (result.success && (!result.errors || result.errors.length === 0)) {
    return 'Successful. Check the report at the Report Panel.';
  }

  if (result.operationResults && result.operationResults.length > 0) {
    const successCount = result.operationResults.filter(r => r.status === 'success').length;
    if (successCount > 0) {
      return 'Partially succeeded. Please check the report at the Report Panel.';
    }
  }

  const firstError = result.errors && result.errors.length > 0 ? result.errors[0] : undefined;
  const friendly = typeof firstError === 'string' ? firstError : firstError?.friendly;
  if (typeof friendly === 'string' && friendly.trim().length > 0) {
    return `Failed: ${friendly} Check the Report Panel.`;
  }

  return 'Failed. Check the report at the Report Panel.';
}

export function reportExecutionResult(
  outputChannel: vscode.OutputChannel,
  getWebview: () => vscode.Webview | undefined,
  result: ExecutionReportInput,
): ReadResultData | null {
  outputChannel.appendLine(result.message);
  for (const err of result.errors) {
    outputChannel.appendLine(`  ERROR: ${err.details}`);
  }

  let readResultData: ReadResultData | null = null;

  if (result.success) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.message);
    } catch {
      parsed = null;
    }

    const candidates = isSerializedReadResult(parsed)
      ? [parsed]
      : isUnknownArray(parsed)
        ? parsed.filter(isSerializedReadResult)
        : [];

    if (candidates.length > 0) {
      readResultData = candidates.reduce<ReadResultData>((merged, item) => ({
        files: [...merged.files, ...item.files],
        totalFiles: merged.totalFiles + item.totalFiles,
        totalSize: merged.totalSize + item.totalSize,
      }), { files: [], totalFiles: 0, totalSize: 0 });
    }
  }

  const pointerMsg = getChatStatusMessage(result);
  const command = result.success ? 'success' : 'error';
  const msg: ExtensionMessage = { command, message: pointerMsg };
  getWebview()?.postMessage(msg);

  if (!result.success) {
    outputChannel.show(true);
  }

  return readResultData;
}

export function transformTerminalOperationData(
  operationResults: OperationResult[],
  originalOperations: FileOperation[],
): { toolKind: 'terminal_command'; data: TerminalGroupData | TerminalResultData }[] {
  const result: { toolKind: 'terminal_command'; data: TerminalGroupData | TerminalResultData }[] = [];
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
  await new Promise<void>(resolve => setTimeout(resolve, 100));
}
