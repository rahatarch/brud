import * as path from 'node:path';
import type {
  BrudSettings,
  ChunkCallback,
  FileOperation,
  FileOperationKind,
  FileOperationResult,
  FileSystem,
  HistoryStore,
  OperationResult,
  SessionMetadata,
  TerminalExecutor,
} from '@brud/core';
import {
  BrudError,
  DEFAULT_SETTINGS,
  executeCommand,
  createTerminalExecutor,
  executeFileOperations,
  executeParallel,
  executeSequential,
  executeTerminalCommand,
  unexpectedError,
} from '@brud/core';
import type {
  HistoryCommitOutcome,
  HistoryCommitSessionResult,
  HistoryReversalTargetState,
  HistoryRevertResult,
  FsListEntry,
} from '@brud/protocol';
import type { DaemonExecutionClient } from './daemonClientTypes';
import { resolveClientWorkspaceRoot } from './daemonClientTypes';
import { DaemonFileSystem } from './daemonFileSystem';
import {
  DaemonPathOutsideWorkspaceError,
  toWorkspaceRelativePath,
} from './daemonPaths';

export const MAX_HISTORY_TARGETS = 5_000;

const READ_ONLY_OPERATION_KINDS: ReadonlySet<FileOperationKind> = new Set([
  'read_file',
  'read_files',
  'read_directory',
  'extract_structure',
  'codebase_metadata',
  'search_files',
  'get_tool_info',
]);

function isMutationOperation(operation: FileOperation): boolean {
  if (operation.kind === 'terminal_command' || operation.kind === 'terminal_interactive') {
    return false;
  }

  return !READ_ONLY_OPERATION_KINDS.has(operation.kind);
}

export interface DaemonExecutionHandlerOptions {
  readonly workspaceRoot: string;
  readonly fallbackFileSystem?: FileSystem;
  readonly legacyHistoryStore?: HistoryStore;
}

export interface DaemonExecuteOptions {
  readonly originalPrompt?: string;
  readonly sessionIdOverride?: string;
  readonly sessionMetadata?: SessionMetadata;
  readonly settings?: BrudSettings;
  readonly onChunk?: ChunkCallback;
  readonly signal?: AbortSignal;
}

export class DaemonExecutionHandler {
  private readonly client: DaemonExecutionClient;

  private readonly workspaceRoot: string;

  private readonly fallbackFileSystem: FileSystem | undefined;

  private readonly legacyHistoryStore: HistoryStore | undefined;

  constructor(client: DaemonExecutionClient, options: DaemonExecutionHandlerOptions) {
    this.client = client;
    this.workspaceRoot = resolveClientWorkspaceRoot(client, options.workspaceRoot);
    this.fallbackFileSystem = options.fallbackFileSystem;
    this.legacyHistoryStore = options.legacyHistoryStore;
  }

  async beginSession(prompt: string, targets: readonly string[] = []): Promise<string> {
    const relativeTargets = targets.map((target) =>
      toWorkspaceRelativePath(this.workspaceRoot, target),
    );
    return this.client.historyBeginSession(prompt, relativeTargets);
  }

  async commitSession(
    sessionId: string,
    outcome: HistoryCommitOutcome = 'completed',
  ): Promise<HistoryCommitSessionResult> {
    return this.client.historyCommitSession(sessionId, outcome);
  }

  async revert(
    sessionId: string,
    targetState: HistoryReversalTargetState = 'pre',
  ): Promise<FileOperationResult> {
    try {
      const outcome = await this.client.historyRevert(sessionId, targetState);
      return this.formatRevertResult(sessionId, targetState, outcome);
    } catch (error: unknown) {
      return this.formatFailure(
        'history.revert',
        error instanceof Error ? error.message : String(error),
        sessionId,
      );
    }
  }

  async execute(
    operations: FileOperation[],
    options: DaemonExecuteOptions = {},
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

    const mutating = operations.some(isMutationOperation);
    let sessionId: string | undefined;

    try {
      sessionId = mutating
        ? await this.beginSession(
          options.originalPrompt?.trim() || 'Brud Code execution',
          await this.collectTargets(operations),
        )
        : undefined;
    } catch (error: unknown) {
      return this.formatFailure(
        'history.beginSession',
        error instanceof Error ? error.message : String(error),
      );
    }

    const fileSystem = new DaemonFileSystem(this.client, {
      workspaceRoot: this.workspaceRoot,
      ...(this.fallbackFileSystem === undefined
        ? {}
        : { fallback: this.fallbackFileSystem }),
    });

    const result = await executeFileOperations(
      operations,
      fileSystem,
      [this.workspaceRoot],
      this.legacyHistoryStore,
      options.originalPrompt,
      createTerminalExecutor(options.onChunk),
      sessionId ?? options.sessionIdOverride,
      options.sessionMetadata,
      options.settings ?? DEFAULT_SETTINGS,
      options.signal,
    );

    if (sessionId !== undefined) {
      try {
        await this.commitSession(sessionId, result.success ? 'completed' : 'aborted');
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        result.errors.push(unexpectedError('history.commitSession', message));
      }
    }

    return { ...result, sessionId };
  }

  private async collectTargets(operations: readonly FileOperation[]): Promise<string[]> {
    const targets = new Set<string>();

    for (const operation of operations) {
      if (!isMutationOperation(operation) || targets.size >= MAX_HISTORY_TARGETS) {
        continue;
      }

      switch (operation.kind) {
        case 'search_replace':
        case 'create_file':
        case 'delete_file':
        case 'append_file':
          this.addTarget(operation.path, targets);
          break;
        case 'rename_file':
        case 'move_file':
        case 'copy_file':
          this.addTarget(operation.from, targets);
          this.addTarget(operation.to, targets);
          break;
        case 'move_directory':
          await this.collectDirectoryFiles(operation.from, targets);
          await this.collectDirectoryFiles(operation.to, targets);
          break;
        case 'create_directory':
          for (const file of operation.files) {
            this.addTarget(path.join(operation.directoryPath, file), targets);
          }
          break;
        case 'delete_directory':
          await this.collectDirectoryFiles(operation.directoryPath, targets);
          break;
        case 'append_file_multi':
        case 'search_replace_multi':
          if (operation.directory !== undefined) {
            await this.collectDirectoryFiles(operation.directory, targets);
          }
          break;
        default:
          break;
      }
    }

    return [...targets];
  }

  private async collectDirectoryFiles(
    directoryPath: string,
    targets: Set<string>,
  ): Promise<void> {
    if (targets.size >= MAX_HISTORY_TARGETS) {
      return;
    }

    let identity: string;

    try {
      identity = toWorkspaceRelativePath(this.workspaceRoot, directoryPath);
    } catch (error: unknown) {
      if (error instanceof DaemonPathOutsideWorkspaceError) {
        return;
      }

      throw error;
    }

    let entries: readonly FsListEntry[];

    try {
      entries = await this.client.fsList(identity);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (targets.size >= MAX_HISTORY_TARGETS) {
        return;
      }

      const childPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory) {
        await this.collectDirectoryFiles(childPath, targets);
      } else {
        this.addTarget(childPath, targets);
      }
    }
  }

  private addTarget(candidatePath: string, targets: Set<string>): void {
    if (targets.size >= MAX_HISTORY_TARGETS) {
      return;
    }

    try {
      targets.add(toWorkspaceRelativePath(this.workspaceRoot, candidatePath));
    } catch (error: unknown) {
      if (!(error instanceof DaemonPathOutsideWorkspaceError)) {
        throw error;
      }
    }
  }

  private formatFailure(
    operationKind: string,
    message: string,
    sessionId?: string,
  ): FileOperationResult {
    const failure = unexpectedError(operationKind, message);

    return {
      success: false,
      message: failure.friendly,
      errors: [failure],
      operationResults: [],
      sessionId,
    };
  }

  private formatRevertResult(
    sessionId: string,
    targetState: HistoryReversalTargetState,
    outcome: HistoryRevertResult,
  ): FileOperationResult {
    const success = outcome.receipt !== null;
    const errors: BrudError[] = outcome.conflicts.map((conflict) => new BrudError({
      code: 'REVERT_CONFLICT',
      friendly: `Cannot revert "${conflict.relativePath}".`,
      details: conflict.message,
      path: conflict.relativePath,
    }));

    if (!success && errors.length === 0) {
      errors.push(new BrudError({
        code: 'REVERT_NOT_EXECUTABLE',
        friendly: 'The session cannot be reverted.',
        details: `The history ledger reported a non-executable reversal plan for session "${sessionId}".`,
      }));
    }

    const operationResults: OperationResult[] = outcome.actions.map((action, index) => ({
      operationId: `REV-${sessionId}-${String(index).padStart(3, '0')}`,
      operationIndex: index,
      kind: 'history_revert',
      status: success ? 'success' : 'failed',
      message: `${action.action} ${action.relativePath}`,
      path: action.relativePath,
    }));

    return {
      success,
      message: success
        ? `Reverted session ${sessionId} to ${targetState}.`
        : `Session ${sessionId} could not be reverted.`,
      errors,
      operationResults,
      sessionId,
    };
  }
}
