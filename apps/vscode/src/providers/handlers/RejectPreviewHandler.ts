import * as vscode from 'vscode';
import type { FileOperation } from '@brud/core';
import { revertSession } from '@brud/core';
import type { ExtensionMessage } from '@brud/protocol';
import { WorkspaceHistoryStore, VSCodeFileSystem, getWorkspaceFolders } from '@brud/vscode-adapter';
import { PanelManager } from '../services/PanelManager';

export class RejectPreviewHandler {
  constructor(
    private panelManager: PanelManager,
    private getDiffPreviewSessionId: () => string | undefined,
    private setFileList: (list: string[]) => void,
    private setOperationsByFile: (map: Map<string, FileOperation[]>) => void,
    private setCurrentFileIndex: (idx: number) => void,
    private setDiffPreviewSessionId: (id: string | undefined) => void,
    private getWebview: () => vscode.Webview | undefined,
  ) {}

  async handle(): Promise<void> {
    const sessionId = this.getDiffPreviewSessionId();
    if (sessionId) {
      try {
        const folders = getWorkspaceFolders();
        if (folders.length > 0) {
          const fs = new VSCodeFileSystem();
          const store = new WorkspaceHistoryStore(folders[0], fs);
          const entry = await store.getSession(sessionId);
          if (entry) {
            await revertSession(entry, 'pre', fs, folders);
          }
          await store.deleteSession(sessionId);
        }
      } catch {
        // Best-effort revert; proceed with cleanup regardless
      }
    }

    this.panelManager.closeDiffPreview();
    this.setFileList([]);
    this.setOperationsByFile(new Map());
    this.setCurrentFileIndex(0);
    this.setDiffPreviewSessionId(undefined);
    const hideMsg: ExtensionMessage = { command: 'hidePreviewNavigation' };
    this.getWebview()?.postMessage(hideMsg);
  }
}