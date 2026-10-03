import { executeFileOperations, FileOperation, executeTerminalCommand, executeCommand, executeSequential, executeParallel, executeConditional, noWorkspaceError } from '@brud/core';
import type { HistoryStore, FileOperationResult, SessionMetadata, BrudSettings, ChunkCallback } from '@brud/core';
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

  const terminalExecutor = {
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
  
  return executeFileOperations(operations, fs, workspaceFolders, historyStore, originalPrompt, terminalExecutor, sessionIdOverride, sessionMetadata, settings);
}