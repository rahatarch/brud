import * as vscode from 'vscode';
import { parseOperations, cleanBrudInput, BrudError } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import { noExtractOperationsError } from '@brud/core';
import type { BrudSettings } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';
import { ErrorReporter } from '../services/ErrorReporter';
import { closePreviewTabs } from '../services/SharedExecutionHelpers';

export class ExtractStructureHandler {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private errorReporter: ErrorReporter,
    private getWebview: () => vscode.Webview | undefined,
    private getSettings: () => BrudSettings,
  ) {}

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

    const result = await executeFileOperations(extractOps, new VSCodeFileSystem(), getWorkspaceFolders(), undefined, undefined, undefined, undefined, undefined, this.getSettings());

    const unifiedOps: { toolKind: string; data: any }[] = [];

    if (!result.success) {
      this.outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this.outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
      this.outputChannel.appendLine('Result: ' + JSON.stringify(result));
      this.outputChannel.appendLine('DirectoryPath: ' + (extractOps[0] as any).directoryPath);
      this.outputChannel.appendLine('Depth: ' + (extractOps[0] as any).depth);
      this.outputChannel.show(true);
    }

    if (result.errors.length > 0) {
      this.outputChannel.appendLine('Extraction had errors: ' + result.errors.join('; '));
    }

    if (result.success && result.errors.length === 0) {
      try {
        const parsed = JSON.parse(result.message);
        const parsedArray = Array.isArray(parsed) ? parsed : [parsed];
        const structureResults = parsedArray.map((item: any) => ({
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

    for (const opResult of result.operationResults) {
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