import * as vscode from 'vscode';
import { parseOperations, cleanBrudInput, BrudError } from '@brud/core';
import { executeFileOperations } from '@brud/core';
import { getWorkspaceFolders, VSCodeFileSystem } from '@brud/vscode-adapter';
import { noExtractOperationsError, executionFailedError } from '@brud/core';
import type { StructureResult, ExtensionMessage, ReportSection, ValidationResult } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';
import { closePreviewTabs } from '../services/SharedExecutionHelpers';

export class ExtractStructureHandler {
  constructor(
    private outputChannel: vscode.OutputChannel,
    private panelManager: PanelManager,
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  async handle(text: string): Promise<void> {
    await closePreviewTabs();

    let operations;
    try {
      operations = parseOperations(cleanBrudInput(text), getWorkspaceFolders());
    } catch (e) {
      if (e instanceof BrudError) {
        this._sendParseErrorToWebview(e);
      } else {
        this._sendParseErrorToWebview(e instanceof Error ? e.message : String(e));
      }
      return;
    }

    const extractOps = operations.filter(op => op.kind === 'extract_structure');
    if (extractOps.length === 0) {
      this._sendErrorToWebview(noExtractOperationsError());
      return;
    }

    const result = await executeFileOperations(extractOps, new VSCodeFileSystem(), getWorkspaceFolders());
    if (!result.success) {
      this.outputChannel.appendLine('=== EXECUTION FAILURE ===');
      this.outputChannel.appendLine('Operations: ' + JSON.stringify(extractOps));
      this.outputChannel.appendLine('Result: ' + JSON.stringify(result));
      this.outputChannel.appendLine('DirectoryPath: ' + (extractOps[0] as any).directoryPath);
      this.outputChannel.appendLine('Depth: ' + (extractOps[0] as any).depth);
      this.outputChannel.show(true);
      this._sendErrorToWebview(executionFailedError(result.message + (result.errors.length > 0 ? ' Errors: ' + result.errors.join('; ') : '')));
      return;
    }

    if (result.errors.length > 0) {
      this.outputChannel.appendLine('Extraction had errors: ' + result.errors.join('; '));
      this._sendErrorToWebview(executionFailedError(result.message + ' Errors: ' + result.errors.join('; ')));
      return;
    }

    let structureResults: StructureResult[] = [];
    try {
      const parsed = JSON.parse(result.message);
      const parsedArray = Array.isArray(parsed) ? parsed : [parsed];
      structureResults = parsedArray.map((item: any) => ({
        json: item.json,
        directoryPath: item.directoryPath,
        depth: item.depth,
        fileCount: item.fileCount,
        directoryCount: item.directoryCount,
      }));
    } catch (e) {
      this.outputChannel.appendLine('Error parsing extract_structure result: ' + (e instanceof Error ? e.message : String(e)));
      return;
    }

    const structureNames = structureResults.map(s => `${s.directoryPath} (depth ${s.depth})`).join(', ');
    const pointerMsg: ExtensionMessage = { command: 'success', message: 'Successful. Check the report at the Report Panel.' };
    this.getWebview()?.postMessage(pointerMsg);
    this.panelManager.showUnifiedResults({
      operations: structureResults.map(s => ({
        toolKind: 'extractionResults',
        data: s,
      })),
    });
    this.outputChannel.appendLine(`Extracted directory structures: ${structureNames}`);
  }

  private _sendErrorToWebview(error: string | { code: string; friendly: string; details: string; path?: string; command?: string } | ValidationResult): void {
    const structured = this._generateErrorReport(error);
    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong.';
    }

    this.panelManager.showUnifiedResults({
      operations: [{
        toolKind: 'error',
        data: { structured, friendlyMessage },
      }],
    });

    if (this.getWebview()) {
      const msg: ExtensionMessage = { command: 'error', message: 'Failed. Check the report at the Report Panel.' };
      this.getWebview()?.postMessage(msg);
    }
    this.outputChannel.appendLine('ERROR: ' + friendlyMessage);
  }

  private _sendParseErrorToWebview(error: string | BrudError | ValidationResult): void {
    const structured = this._generateErrorReport(error);
    structured.push({ type: 'button', buttonText: 'Go to Prompt Library', buttonAction: 'openPromptLibrary' });

    let friendlyMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
    } else {
      friendlyMessage = error.friendly || 'I couldn\'t understand the format of your message.';
    }

    this.panelManager.showUnifiedResults({
      operations: [{
        toolKind: 'error',
        data: { structured, friendlyMessage },
      }],
    });

    if (this.getWebview()) {
      const msg: ExtensionMessage = { command: 'error', message: 'Failed. Check the report at the Report Panel.' };
      this.getWebview()?.postMessage(msg);
    }
    this.outputChannel.appendLine('ERROR: ' + friendlyMessage);
  }

  private _generateErrorReport(error: string | { code: string; friendly: string; details: string; path?: string; command?: string } | ValidationResult): ReportSection[] {
    const sections: ReportSection[] = [];
    let friendlyMessage: string;
    let detailMessage: string;
    if (typeof error === 'string') {
      friendlyMessage = error;
      detailMessage = error;
    } else {
      friendlyMessage = error.friendly || 'Something went wrong. Here are the details:';
      detailMessage = error.details || friendlyMessage;
    }

    if (detailMessage !== friendlyMessage) {
      sections.push({ type: 'details', title: 'Error Details', content: detailMessage });
    }
    sections.push({ type: 'button', buttonText: 'See Details', buttonAction: 'openUnifiedResults' });

    return sections;
  }
}