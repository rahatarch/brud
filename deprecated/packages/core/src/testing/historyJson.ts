import type { HistorySession } from '../history/types.js';

export interface SerializedSnapshotData {
  sessionId: string;
  snapshotType: 'pre' | 'post';
  files: Record<string, string>;
  diffFromPrevious: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function isHistoryOperation(value: unknown): boolean {
  return isRecord(value)
    && typeof value.operationId === 'string'
    && typeof value.operationIndex === 'number'
    && typeof value.kind === 'string'
    && typeof value.status === 'string'
    && typeof value.message === 'string'
    && typeof value.path === 'string';
}

function isHistorySession(value: unknown): value is HistorySession {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && typeof value.timestamp === 'string'
    && typeof value.originalPrompt === 'string'
    && (value.status === 'success' || value.status === 'failure')
    && typeof value.operationCount === 'number'
    && isStringArray(value.operationTypes)
    && Array.isArray(value.operations)
    && value.operations.every(isHistoryOperation)
    && isStringArray(value.filesAffected)
    && isRecord(value.metadataUsed)
    && isStringArray(value.terminalCommands)
    && isStringArray(value.revertCommands);
}

function isSerializedSnapshotData(value: unknown): value is SerializedSnapshotData {
  return isRecord(value)
    && typeof value.sessionId === 'string'
    && (value.snapshotType === 'pre' || value.snapshotType === 'post')
    && isRecord(value.files)
    && Object.values(value.files).every(item => typeof item === 'string')
    && typeof value.diffFromPrevious === 'string';
}

export function parseHistorySession(raw: string): HistorySession {
  const parsed: unknown = JSON.parse(raw);
  if (!isHistorySession(parsed)) {
    throw new Error('Invalid history session data');
  }
  return parsed;
}

export function parseSerializedSnapshot(raw: string): SerializedSnapshotData {
  const parsed: unknown = JSON.parse(raw);
  if (!isSerializedSnapshotData(parsed)) {
    throw new Error('Invalid snapshot data');
  }
  return parsed;
}
