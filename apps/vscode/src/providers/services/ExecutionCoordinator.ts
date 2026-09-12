import { executeOperationsFromVSCode, getWorkspaceFolders, WorkspaceHistoryStore, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { FileOperation, FileOperationResult, SessionMetadata } from '@brud/core';

export class ExecutionCoordinator {
  constructor(
    private getWorkspaceFoldersFunc: () => string[] = getWorkspaceFolders,
  ) {}

  async execute(
    operations: FileOperation[],
    sourceText?: string,
    sessionIdOverride?: string,
    sessionMetadata?: SessionMetadata,
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

    return executeOperationsFromVSCode(operations, historyStore, sourceText, sessionIdOverride, sessionMetadata);
  }
}