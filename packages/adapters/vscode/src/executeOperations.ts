import { executeFileOperations, FileOperation, validateWorkspacePath } from '@brud/core';
import type { HistoryStore } from '@brud/core';
import type { OperationResult } from '@brud/core';
import { VSCodeFileSystem } from './filesystem';
import { getWorkspaceFolders } from './workspace';

export async function executeOperationsFromVSCode(
  operations: FileOperation[],
  historyStore?: HistoryStore,
  originalPrompt?: string,
): Promise<{ success: boolean; message: string; errors: string[]; operationResults: OperationResult[] }> {
  const fs = new VSCodeFileSystem();
  const workspaceFolders = getWorkspaceFolders();
  
  if (workspaceFolders.length === 0) {
    return {
      success: false,
      message: 'No workspace is currently open. Open a folder in VS Code to use file operations.',
      errors: ['No workspace is currently open. Open a folder in VS Code to use file operations.'],
      operationResults: [],
    };
  }
  
  return executeFileOperations(operations, fs, workspaceFolders, historyStore, originalPrompt);
}