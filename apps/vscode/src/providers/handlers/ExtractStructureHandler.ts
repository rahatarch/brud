import * as vscode from 'vscode';
import { parseOperations, cleanBrudInput, BrudError, noExtractOperationsError } from '@brud/core';
import { bootCoreKernel } from '@brud/core';
import { getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { BrudKernel, BrudSettings, FileOperation } from '@brud/core';
import { isRecord } from '@brud/protocol';
import type { ExtensionMessage, OperationResult, StructureResult, UnifiedOperationResult } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';
import { ErrorReporter } from '../services/ErrorReporter';
import { closePreviewTabs } from '../services/SharedExecutionHelpers';
import { isStructureResult, readOperationResults } from '../services/executionPayloads';

function describeError(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return typeof value === 'string' ? value : String(value);
}

export class ExtractStructureHandler {
  private kernelPromise: Promise<BrudKernel> | null = null;

  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private errorReporter: ErrorReporter,
    private getWebview: () => vscode.Webview | undefined,
    private getSettings: () => BrudSettings,
  ) {}

  private async getKernel(): Promise<BrudKernel> {
    if (!this.kernelPromise) {
      this.kernelPromise = bootCoreKernel({
        fs: new VSCodeFileSystem(),
      });
    }
    return this.kernelPromise;
  }

  async handle(text: string): Promise<void> {
    await closePreviewTabs();

    let operations: FileOperation[];
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
    } catch (e) {
      if (e instanceof BrudError) {
        this.errorReporter.sendParseError(e);
      } else {
        this.errorReporter.sendParseError(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const extractOps = operations.filter(op => op.kind === 'extract_structure');
    if (extractOps.length === 0) {
      this.errorReporter.sendError(noExtractOperationsError());
      return;
    }

    const kernel = await this.getKernel();

    const extractionResults: StructureResult[] = [];
    const operationResults: OperationResult[] = [];
    const errors: string[] = [];
    let allSuccess = true;

    for (const op of extractOps) {
      const result = await kernel.execute<FileOperation, unknown>('extract_structure', op);
      if (result.status === 'success' && isRecord(result.data)) {
        const data = result.data;
        const extracted = Array.isArray(data.extractionResults)
          ? data.extractionResults.filter(isStructureResult)
          : [];
        const operationData = readOperationResults(data.operationResults);
        extractionResults.push(...extracted);
        operationResults.push(...operationData.filter(item => item.kind === 'extract_structure'));
        if (Array.isArray(data.errors)) {
          errors.push(...data.errors.map(describeError));
        }
      } else {
        allSuccess = false;
        errors.push(describeError(result.error));
      }
    }

    const unifiedOps: UnifiedOperationResult[] = [];

    if (!allSuccess) {
      this.outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this.outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
      this.outputChannel.appendLine('Errors: ' + JSON.stringify(errors));
      this.outputChannel.show(true);
    }

    if (errors.length > 0) {
      this.outputChannel.appendLine('Extraction had errors: ' + errors.join('; '));
    }

    if (allSuccess && errors.length === 0) {
      try {
        for (const structure of extractionResults) {
          unifiedOps.push({ toolKind: 'extractionResults', data: structure });
        }
        const structureNames = extractionResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
        this.outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
        const pointerMsg: ExtensionMessage = { command: 'success', message: 'Successful. Check the report at the Report Panel.' };
        this.getWebview()?.postMessage(pointerMsg);
      } catch (e) {
        this.outputChannel.appendLine('Error parsing extract_structure result: ' + describeError(e));
      }
    }

    for (const opResult of operationResults) {
      unifiedOps.push({
        toolKind: opResult.kind,
        data: opResult,
      });
    }

    if (unifiedOps.length > 0) {
      this.panelManager.showUnifiedResults({ operations: unifiedOps });
    }
  }
}