export interface HistorySession {
  sessionId: string;
  timestamp: string;
  originalPrompt: string;
  status: 'success' | 'failure';
  operationCount: number;
  operationTypes: string[];
  filesAffected: string[];
  metadataUsed: Record<string, any>;
  terminalCommands: string[];
  revertCommands: string[];
}

export type SnapshotType = 'pre' | 'post';

export interface SnapshotData {
  sessionId: string;
  snapshotType: SnapshotType;
  /** For 'pre' snapshots: full file content. For 'post' snapshots: unified diffs from pre. */
  files: Map<string, string>;
  diffFromPrevious: string;
}

export interface HistoryEntry {
  session: HistorySession;
  preSnapshot: SnapshotData;
  postSnapshot: SnapshotData;
}