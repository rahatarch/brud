import { bootCoreKernel, noWorkspaceError, isBrudError } from '@brud/core';
import type { FileOperation, FileOperationResult, SessionMetadata, BrudSettings, ChunkCallback, HistoryStore } from '@brud/core';
import { DEFAULT_SETTINGS } from '@brud/core';
import { executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional } from '@brud/core';
import type { TerminalExecutor } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

function describeThrownError(err: unknown): { code: string; friendly: string; details: string } {
  if (isBrudError(err)) {
    return { code: err.code, friendly: err.friendly, details: err.details };
  }
  if (err instanceof Error) {
    return { code: 'EXECUTION_ERROR', friendly: err.message, details: err.message };
  }
  const text = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
  return { code: 'EXECUTION_ERROR', friendly: text, details: text };
}

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
    executeCommand: (command: string, cwd?: string, timeout?: number, env?: Record<string, string>, _onChunk?: any, signal?: AbortSignal) =>
      executeCommand(command, cwd, timeout, env, onChunk, signal),
    executeSequential: (commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, stopOnFailure?: boolean, _onChunk?: any, signal?: AbortSignal) =>
      executeSequential(commands, cwd, timeout, env, stopOnFailure, onChunk, signal),
    executeParallel: (commands: string[], cwd?: string, timeout?: number, env?: Record<string, string>, _onChunk?: any, signal?: AbortSignal) =>
      executeParallel(commands, cwd, timeout, env, onChunk, signal),
    executeConditional: (conditional: any, cwd?: string, timeout?: number, env?: Record<string, string>, _onChunk?: any, signal?: AbortSignal) =>
      executeConditional(conditional, cwd, timeout, env, onChunk, signal),
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
  const combinedPayload: Record<string, unknown> = {};

  function tryMergeMessage(message: string): void {
    if (!message) return;
    try {
      const parsed = JSON.parse(message);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const STRUCTURED_KEYS = new Set(['codebase_metadata', 'extractionResults', 'readResults', 'search_results']);
        for (const key of STRUCTURED_KEYS) {
          if (key in parsed && parsed[key] !== undefined) {
            if (Array.isArray(parsed[key])) {
              const existing = Array.isArray(combinedPayload[key]) ? (combinedPayload[key] as any[]) : [];
              combinedPayload[key] = [...existing, ...(parsed[key] as any[])];
            } else {
              combinedPayload[key] = parsed[key];
            }
          }
        }
      }
    } catch {
      /* not JSON, skip */
    }
  }

  for (let i = 0; i < operations.length; i++) {
    const operation = operations[i];
    try {
      const result = await kernel.execute(
        operation.kind,
        operation,
        {
          workspaceRoot,
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
        tryMergeMessage(legacyResult.message);
        if (legacyResult.operationResults) {
          for (const opRes of legacyResult.operationResults) {
            tryMergeMessage(opRes.message);
          }
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
      const described = describeThrownError(err);
      errors.push(described);
      operationResults.push({
        operationIndex: i,
        operationId: `OP-${Date.now()}-${String(i).padStart(3, '0')}`,
        kind: operation.kind,
        status: 'failed',
        message: `Unexpected error: ${described.friendly}`,
        ...(described.code ? { code: described.code } : {}),
        ...(described.details ? { details: described.details } : {}),
        path: 'path' in operation ? (operation as any).path || '' : '',
      });
    }
  }

  const anySuccess = operationResults.some(r => r.status === 'success');
  const summaryMessage = anySuccess
    ? `Completed ${operationResults.filter(r => r.status === 'success').length} of ${operations.length} operations.`
    : 'All operations failed.';
  return {
    success: anySuccess,
    message: Object.keys(combinedPayload).length > 0
      ? JSON.stringify(combinedPayload)
      : summaryMessage,
    errors,
    operationResults,
    sessionId: lastSessionId,
  };
}