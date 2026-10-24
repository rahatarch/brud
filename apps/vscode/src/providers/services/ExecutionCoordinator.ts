import { DaemonExecutionHandler, getWorkspaceFolders, WorkspaceHistoryStore, VSCodeFileSystem } from '@brud/vscode-adapter';
import type { FileOperation, FileOperationResult, SessionMetadata, BrudSettings, ChunkCallback } from '@brud/core';
import { DEFAULT_SETTINGS, killProcess, getActiveProcessIds, noWorkspaceError, unexpectedError } from '@brud/core';
import type { DaemonClient } from '@brud/daemon';

export type DaemonClientProvider = () => Promise<DaemonClient | undefined>;

export type DaemonClientSource = DaemonClient | DaemonClientProvider;

function describeDaemonError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ExecutionCoordinator {
  constructor(
    private getWorkspaceFoldersFunc: () => string[] = getWorkspaceFolders,
    private getSettings: () => BrudSettings = () => DEFAULT_SETTINGS,
    private daemonClientSource: DaemonClientSource = async () => undefined,
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
    if (folders.length === 0) {
      const error = noWorkspaceError();
      return {
        success: false,
        message: error.friendly,
        errors: [error],
        operationResults: [],
        sessionId: undefined,
      };
    }

    let client: DaemonClient | undefined;

    try {
      client = typeof this.daemonClientSource === 'function'
        ? await this.daemonClientSource()
        : this.daemonClientSource;
    } catch (error: unknown) {
      const failure = unexpectedError(
        'daemon.connect',
        describeDaemonError(error),
      );
      return {
        success: false,
        message: failure.friendly,
        errors: [failure],
        operationResults: [],
        sessionId: undefined,
      };
    }

    if (client === undefined) {
      const failure = unexpectedError(
        'daemon.connect',
        'No authenticated daemon connection is available for this workspace.',
      );
      return {
        success: false,
        message: failure.friendly,
        errors: [failure],
        operationResults: [],
        sessionId: undefined,
      };
    }

    const fileSystem = new VSCodeFileSystem();
    const historyStore = new WorkspaceHistoryStore(folders[0], fileSystem);
    const handler = new DaemonExecutionHandler(client, {
      workspaceRoot: folders[0],
      fallbackFileSystem: fileSystem,
      legacyHistoryStore: historyStore,
    });

    return handler.execute(operations, {
      ...(sourceText === undefined ? {} : { originalPrompt: sourceText }),
      ...(sessionIdOverride === undefined ? {} : { sessionIdOverride }),
      ...(sessionMetadata === undefined ? {} : { sessionMetadata }),
      onChunk,
      settings: this.getSettings(),
    });
  }

  killActiveProcess(processId: string): boolean {
    return killProcess(processId);
  }

  getActiveProcessIds(): string[] {
    return getActiveProcessIds();
  }
}
