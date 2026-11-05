import { bootCoreKernel, noWorkspaceError, isBrudError } from '@brud/core';
import type { FileOperation, FileOperationResult, OperationResult, SessionMetadata, BrudSettings, ChunkCallback, HistoryStore } from '@brud/core';
import { DEFAULT_SETTINGS } from '@brud/core';
import { createTerminalExecutor } from '@brud/core';
import type { TerminalExecutor } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function getOperationTarget(operation: FileOperation): string {
  if ('directoryPath' in operation) {
    return operation.directoryPath;
  }
  if ('directory' in operation && typeof operation.directory === 'string') {
    return operation.directory;
  }
  if ('path' in operation) {
    return operation.path;
  }
  if ('from' in operation) {
    return operation.from;
  }
  if ('command' in operation) {
    return operation.command;
  }
  if ('toolKind' in operation) {
    return operation.toolKind ?? '';
  }
  return '';
}

function isFileOperationResult(value: unknown): value is FileOperationResult {
  return isRecord(value)
    && typeof value.success === 'boolean'
    && typeof value.message === 'string'
    && Array.isArray(value.errors)
    && Array.isArray(value.operationResults);
}

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

  // The executor is a facade over the kernel terminal authority; the stream
  // sink of this transport is bound once, and `bootCoreKernel` binds the
  // authority the facade and the UI kill registry share.
  const terminalExecutor: TerminalExecutor = createTerminalExecutor(onChunk);

  const kernel = await bootCoreKernel({
    fs,
    terminal: terminalExecutor,
    history: historyStore,
    settings,
  });

  const workspaceRoot = workspaceFolders[0];
  const operationResults: OperationResult[] = [];
  const errors: Array<{ code: string; friendly: string; details: string; path?: string; command?: string }> = [];
  let lastSessionId: string | undefined;
  const combinedPayload: Record<string, unknown> = {};

  function tryMergeMessage(message: string): void {
    if (!message) return;
    try {
      const parsed: unknown = JSON.parse(message);
      if (isRecord(parsed)) {
        const STRUCTURED_KEYS = new Set(['codebase_metadata', 'extractionResults', 'readResults', 'search_results']);
        for (const key of STRUCTURED_KEYS) {
          const value = parsed[key];
          if (value === undefined) {
            continue;
          }
          if (isUnknownArray(value)) {
            const existing = combinedPayload[key];
            const existingItems = isUnknownArray(existing) ? existing : [];
            combinedPayload[key] = [...existingItems, ...value];
          } else {
            combinedPayload[key] = value;
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

      const legacyResult = isFileOperationResult(result.data) ? result.data : undefined;
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
          path: getOperationTarget(operation),
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
        path: getOperationTarget(operation),
        ...('to' in operation ? { to: operation.to } : {}),
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