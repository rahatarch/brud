import * as vscode from 'vscode';
import { parseOperations, cleanBrudInput, BrudError, noExtractOperationsError } from '@brud/core';
import { bootCoreKernel } from '@brud/core';
import { getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { BrudSettings } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';
import { ErrorReporter } from '../services/ErrorReporter';
import { closePreviewTabs } from '../services/SharedExecutionHelpers';

export class ExtractStructureHandler {
  private kernelPromise: Promise<any> | null = null;

  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private errorReporter: ErrorReporter,
    private getWebview: () => vscode.Webview | undefined,
    private getSettings: () => BrudSettings,
  ) {}

  private async getKernel(): Promise<any> {
    if (!this.kernelPromise) {
      this.kernelPromise = bootCoreKernel({
        fs: new VSCodeFileSystem(),
      });
    }
    return this.kernelPromise;
  }

  async handle(text: string): Promise<void> {
    await closePreviewTabs();

    let operations;
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

    const extractionResults: { directoryPath: string; depth: number; json: string; fileCount: number; directoryCount: number }[] = [];
    const operationResults: any[] = [];
    const errors: any[] = [];
    let allSuccess = true;

    for (const op of extractOps) {
      const result = await kernel.execute('extract_structure', op);
      if (result.status === 'success' && result.data) {
        const data = result.data as any;
        const sr = data.operationResults?.find((r: any) => r.kind === 'extract_structure');
        const er = extractionResults.find(e => e.directoryPath === op.directoryPath) || ({
          directoryPath: op.directoryPath,
          depth: op.depth,
          json: '',
          fileCount: 0,
          directoryCount: 0,
        });
        if (data.extractionResults?.length > 0) {
          extractionResults.push(...data.extractionResults);
        }
        if (sr) {
          operationResults.push(sr);
        }
        if (data.errors?.length > 0) {
          errors.push(...data.errors);
        }
      } else {
        allSuccess = false;
        errors.push(result.error || 'Unknown error');
      }
    }

    const unifiedOps: { toolKind: string; data: any }[] = [];

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
        const structureResults = extractionResults.map((item: any) => ({
          json: item.json,
          directoryPath: item.directoryPath,
          depth: item.depth,
          fileCount: item.fileCount,
          directoryCount: item.directoryCount,
        }));
        unifiedOps.push(...structureResults.map(s => ({
          toolKind: 'extractionResults',
          data: s,
        })));
        const structureNames = structureResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
        this.outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
        const pointerMsg: ExtensionMessage = { command: 'success', message: 'Successful. Check the report at the Report Panel.' };
        this.getWebview()?.postMessage(pointerMsg);
      } catch (e) {
        this.outputChannel.appendLine('Error parsing extract_structure result: ' + (e instanceof Error ? e.message : String(e)));
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