import { executeOperationsFromVSCode, getWorkspaceFolders, WorkspaceHistoryStore, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { FileOperation, FileOperationResult, SessionMetadata, BrudSettings, ChunkCallback } from '@brud/core';
import { DEFAULT_SETTINGS, killProcess, getActiveProcessIds } from '@brud/core';

export class ExecutionCoordinator {
  constructor(
    private getWorkspaceFoldersFunc: () => string[] = getWorkspaceFolders,
    private getSettings: () => BrudSettings = () => DEFAULT_SETTINGS,
  ) {}

  async execute(
    operations: FileOperation[],
    sourceText?: string,
    sessionIdOverride?: string,
    sessionMetadata?: SessionMetadata,
    onChunk?: ChunkCallback,
  ): Promise<FileOperationResult> {
    if (operations.length === 0) {
      return {
        success: false,
        message: 'No operations to execute.',
        errors: [],
        operationResults: [],
        sessionId: undefined,
      };
    }

    const folders = this.getWorkspaceFoldersFunc();
    const historyStore = folders.length > 0
      ? new WorkspaceHistoryStore(folders[0], new VSCodeFileSystem())
      : undefined;

    return executeOperationsFromVSCode(operations, historyStore, sourceText, sessionIdOverride, sessionMetadata, this.getSettings(), onChunk);
  }

  killActiveProcess(processId: string): boolean {
    return killProcess(processId);
  }

  getActiveProcessIds(): string[] {
    return getActiveProcessIds();
  }
}