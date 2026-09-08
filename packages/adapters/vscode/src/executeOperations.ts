import { executeFileOperations, FileOperation, executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional, noWorkspaceError } from '@brud/core';
import type { HistoryStore, FileOperationResult } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

export async function executeOperationsFromVSCode(
  operations: FileOperation[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
  sessionIdOverride?: string,
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
  
  return executeFileOperations(operations, fs, workspaceFolders, historyStore, originalPrompt, { execute: executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional }, sessionIdOverride);
}