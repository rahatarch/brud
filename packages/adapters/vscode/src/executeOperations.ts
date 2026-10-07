import { bootCoreKernel, noWorkspaceError } from '@brud/core';
import type { FileOperation, FileOperationResult, SessionMetadata, BrudSettings, ChunkCallback, HistoryStore } from '@brud/core';
import { DEFAULT_SETTINGS } from '@brud/core';
import { executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional } from '@brud/core';
import type { TerminalExecutor } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

export async function executeOperationsFromVSCode(
  operations: FileOperation[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
  sessionIdOverride?: string,
  sessionMetadata?: SessionMetadata,
  settings: BrudSettings = DEFAULT_SETTINGS,
  onChunk?: ChunkCallback,
): Promise<FileOperationResult> {
  const fs = new VSCodeFileSystem();
  const workspaceFolders = getWorkspaceFolders();

  if (workspaceFolders.length === 0) {
    const err = noWorkspaceError();
    return {
      success: false,
      message: err.friendly,
      errors: [err],
      operationResults: [],
    };
  }

  const terminalExecutor: TerminalExecutor = {
    execute: executeTerminalCommand,
    executeCommand: (command: string, cwd?: string, timeout?: number, env?: Record<string, string>) =>
      executeCommand(command, cwd, timeout, env, onChunk),
    executeSequential: (commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, stopOnFailure?: boolean) =>
      executeSequential(commands, cwd, timeout, env, stopOnFailure, onChunk),
    executeParallel: (commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>) =>
      executeParallel(commands, cwd, timeout, env, onChunk),
    executeConditional: (conditional: any, cwd?: string, timeout?: number, env?: Record<string, string>) =>
      executeConditional(conditional, cwd, timeout, env, onChunk),
  };

  const kernel = await bootCoreKernel({
    fs,
    terminal: terminalExecutor,
    history: historyStore,
    settings,
  });

  const workspaceRoot = workspaceFolders[0];
  const operationResults: Array<{
    operationId: string;
    operationIndex: number;
    kind: string;
    status: 'success' | 'aborted' | 'failed' | 'interrupted';
    message: string;
    path: string;
    from?: string;
    to?: string;
    directoryPath?: string;
    files?: string[];
    title?: string;
    description?: string;
    fileResults?: {
      modified: string[];
      skipped: string[];
      failed: string[];
    };
    data?: { command: string; output: string; exitCode: number | null; duration: number; success: boolean } | Array<{ command: string; output: string; exitCode: number | null; duration: number; success: boolean }>;
  }> = [];
  const errors: Array<{ code: string; friendly: string; details: string; path?: string; command?: string }> = [];
  let lastSessionId: string | undefined;

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    try {
      const result = await kernel.execute(
        operation.kind,
        operation,
        {
          metadata: {
            workspaceRoot,
            sessionId: sessionIdOverride,
            originalPrompt,
            ...sessionMetadata,
            operationIndex: i,
          },
        },
      );

      const legacyResult = result.data as FileOperationResult | undefined;
      if (legacyResult) {
        if (legacyResult.operationResults) {
          operationResults.push(...legacyResult.operationResults);
        }
        if (legacyResult.errors) {
          errors.push(...legacyResult.errors);
        }
        if (legacyResult.sessionId) {
          lastSessionId = legacyResult.sessionId;
        }
      } else {
        operationResults.push({
          operationIndex: i,
          operationId: `OP-${Date.now()}-${String(i).padStart(3, '0')}`,
          kind: operation.kind,
          status: result.status === 'success' ? 'success' : 'failed',
          message: result.message || (result.error ? String(result.error) : '') || `Operation ${operation.kind} completed.`,
          path: 'path' in operation ? (operation as any).path || '' : '',
        });
      }
    } catch (err) {
      errors.push({
        code: 'EXECUTION_ERROR',
        friendly: String(err),
        details: String(err),
      });
      operationResults.push({
        operationIndex: i,
        operationId: `OP-${Date.now()}-${String(i).padStart(3, '0')}`,
        kind: operation.kind,
        status: 'failed',
        message: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
        path: 'path' in operation ? (operation as any).path || '' : '',
      });
    }
  }

  const anySuccess = operationResults.some(r => r.status === 'success');
  return {
    success: anySuccess,
    message: anySuccess
      ? `Completed ${operationResults.filter(r => r.status === 'success').length} of ${operations.length} operations.`
      : 'All operations failed.',
    errors,
    operationResults,
    sessionId: lastSessionId,
  };
}