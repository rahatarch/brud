import { createTwoFilesPatch } from 'diff';
import type { FileOperation } from '../types/patch.js';
import type { FileSystem } from '../types/filesystem.js';
import { generateSessionId } from './sessionId.js';
import type { HistorySession, SnapshotData, HistoryEntry } from './types.js';
import type { HistoryStore } from './store.js';

let sequenceCounter = 0;

export function recordSession(
  operations: FileOperation[],
  result: { success: boolean; message: string; errors: string[] },
  filesAffected: string[],
  originalPrompt: string,
  sessionIdOverride?: string,
): HistorySession {
  sequenceCounter++;
  const now = new Date();
  const sessionId = sessionIdOverride || generateSessionId(now, sequenceCounter);

  const status: 'success' | 'failure' = result.success && result.errors.length === 0 ? 'success' : 'failure';

  const operationTypes = operations.map(op => op.kind);

  const metadataUsed: Record<string, any> = {};
  for (const op of operations) {
    if (!metadataUsed[op.kind]) {
      metadataUsed[op.kind] = [];
    }
    const entry: Record<string, any> = {};
    switch (op.kind) {
      case 'search_replace':
        entry.path = op.path;
        entry.index = op.index;
        break;
      case 'create_file':
        entry.path = op.path;
        entry.index = op.index;
        break;
      case 'delete_file':
        entry.path = op.path;
        entry.index = op.index;
        break;
      case 'rename_file':
        entry.from = op.from;
        entry.to = op.to;
        entry.index = op.index;
        break;
      case 'move_file':
        entry.from = op.from;
        entry.to = op.to;
        entry.index = op.index;
        break;
      case 'copy_file':
        entry.from = op.from;
        entry.to = op.to;
        entry.index = op.index;
        break;
      case 'append_file':
        entry.path = op.path;
        entry.position = op.position;
        entry.index = op.index;
        break;
      case 'create_directory':
        entry.directoryPath = op.directoryPath;
        entry.index = op.index;
        break;
      case 'delete_directory':
        entry.directoryPath = op.directoryPath;
        entry.index = op.index;
        break;
      case 'move_directory':
        entry.from = op.from;
        entry.to = op.to;
        entry.index = op.index;
        break;
      case 'extract_structure':
        entry.directoryPath = op.directoryPath;
        entry.depth = op.depth;
        entry.index = op.index;
        break;
      case 'codebase_metadata':
        entry.index = op.index;
        break;
    }
    metadataUsed[op.kind].push(entry);
  }

  return {
    sessionId,
    timestamp: now.toISOString(),
    originalPrompt,
    status,
    operationCount: operations.length,
    operationTypes,
    filesAffected,
    metadataUsed,
    terminalCommands: [],
    revertCommands: [],
  };
}

export async function createSnapshot(
  sessionId: string,
  snapshotType: 'pre' | 'post',
  fs: FileSystem,
  filesAffected: string[],
  preSnapshot?: SnapshotData,
): Promise<SnapshotData> {
  const files = new Map<string, string>();

  if (snapshotType === 'pre') {
    for (const filePath of filesAffected) {
      try {
        const exists = await fs.exists(filePath);
        if (exists) {
          const content = await fs.readFile(filePath);
          files.set(filePath, content);
        }
      } catch {
        // File may not exist yet (e.g., pre-snapshot for a file that will be created)
      }
    }
  } else {
    for (const filePath of filesAffected) {
      try {
        const exists = await fs.exists(filePath);
        if (exists) {
          const postContent = await fs.readFile(filePath);
          const preContent = preSnapshot?.files.get(filePath) ?? '';
          const diff = preContent === postContent
            ? ''
            : createTwoFilesPatch(filePath, filePath, preContent, postContent, 'pre', 'post');
          files.set(filePath, diff);
        } else if (preSnapshot?.files.has(filePath)) {
          const preContent = preSnapshot.files.get(filePath)!;
          const diff = createTwoFilesPatch(filePath, filePath, preContent, '', 'pre', 'post');
          files.set(filePath, diff);
        }
      } catch {
        // File not accessible for post-snapshot
      }
    }
  }

  return {
    sessionId,
    snapshotType,
    files,
    diffFromPrevious: '',
  };
}

export async function recordAndSaveSession(
  operations: FileOperation[],
  result: { success: boolean; message: string; errors: string[] },
  filesAffected: string[],
  originalPrompt: string,
  preSnapshot: SnapshotData,
  postSnapshot: SnapshotData,
  historyStore: HistoryStore,
  sessionIdOverride?: string,
): Promise<HistorySession> {
  const session = recordSession(operations, result, filesAffected, originalPrompt, sessionIdOverride);

  const entry: HistoryEntry = {
    session,
    preSnapshot,
    postSnapshot,
  };

  await historyStore.saveSession(entry);

  return session;
}