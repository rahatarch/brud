import { executeFileOperations, FileOperation, executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional, noWorkspaceError } from '@brud/core';
import type { HistoryStore, FileOperationResult, SessionMetadata, BrudSettings } from '@brud/core';
import { DEFAULT_SETTINGS } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

export async function executeOperationsFromVSCode(
  operations: FileOperation[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
  sessionIdOverride?: string,
  sessionMetadata?: SessionMetadata,
  settings: BrudSettings = DEFAULT_SETTINGS,
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
  
  return executeFileOperations(operations, fs, workspaceFolders, historyStore, originalPrompt, { execute: executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional }, sessionIdOverride, sessionMetadata, settings);
}