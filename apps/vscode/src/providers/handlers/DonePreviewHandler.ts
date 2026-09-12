import * as vscode from 'vscode';
import type { FileOperation } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { PanelManager } from '../services/PanelManager';

export class DonePreviewHandler {
  constructor(
    private panelManager: PanelManager,
    private getFileList: () => string[],
    private getOperationsByFile: () => Map<string, FileOperation[]>,
    private getLastExecutionResult: () => { operations: { toolKind: string; data: any }[] } | null,
    private getWebview: () => vscode.Webview | undefined,
    private setFileList: (list: string[]) => void,
    private setOperationsByFile: (map: Map<string, FileOperation[]>) => void,
    private setCurrentFileIndex: (idx: number) => void,
    private setDiffPreviewSessionId: (id: string | undefined) => void,
    private setSessionMetadata: (m: any) => void,
  ) {}

  async handle(): Promise<void> {
    const lastResult = this.getLastExecutionResult();
    if (lastResult && lastResult.operations.length > 0) {
      this.panelManager.showUnifiedResults(lastResult);
    }

    this.panelManager.closeDiffPreview();
    this.setFileList([]);
    this.setOperationsByFile(new Map());
    this.setCurrentFileIndex(0);
    this.setDiffPreviewSessionId(undefined);
    this.setSessionMetadata(undefined);
    const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
    this.getWebview()?.postMessage(hideMsg);
  }
}