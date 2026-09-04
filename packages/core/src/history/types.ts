export interface SoftDeleteEvent {
  action: 'soft_delete' | 'restore';
  at: string;
  by: 'user' | 'system';
  reason?: 'manual_delete' | 'manual_wipe' | 'retention_cleanup';
}

export interface HistorySession {
  sessionId: string;
  timestamp: string;
  originalPrompt: string;
  status: 'success' | 'failure';
  operationCount: number;
  operationTypes: string[];
  operations: OperationResult[];
  filesAffected: string[];
  metadataUsed: Record<string, any>;
  terminalCommands: string[];
  revertCommands: string[];
  isDeleted?: boolean;
  deletedAt?: string;
  expiresAt?: string;
  deletedBy?: 'user' | 'system';
  deleteReason?: 'manual_delete' | 'manual_wipe' | 'retention_cleanup';
  renewedAt?: string;
  softDeleteHistory?: SoftDeleteEvent[];
}

export interface OperationResult {
  operationId: string;
  operationIndex: number;
  kind: string;
  status: 'success' | 'aborted' | 'failed';
  message: string;
  path: string;
  from?: string;
  to?: string;
  directoryPath?: string;
  files?: string[];
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

export interface RevertHistoryEntry {
  revertId: string;
  timestamp: string;
  targetState: 'pre' | 'post';
  revertedOperationIds: string[];
  status: 'success' | 'failed';
  errorMessage?: string;
}

export interface RevertHistory {
  sessionId: string;
  reverts: RevertHistoryEntry[];
}

export type DeleteHistoryEntry =
  | {
      deleteId: string;
      timestamp: string;
      deletedCount: number;
      deletedSessions: Array<{ sessionId: string; createdAt: string }>;
      reason: 'retention_cleanup' | 'manual_wipe' | 'manual_delete';
      triggeredBy: 'system' | 'user';
      confirmationPhrase?: string;
      failedAttempts?: Array<{ timestamp: string; attemptedPhrase: string; expectedPhrase: string }>;
    }
  | {
      deleteId: string;
      sessionId: string;
      action: 'soft_delete';
      timestamp: string;
      deletedBy: 'user' | 'system';
      reason: 'manual_delete' | 'manual_wipe' | 'retention_cleanup';
      expiresAt: string;
    }
  | {
      deleteId: string;
      sessionId: string;
      action: 'restore';
      timestamp: string;
      restoredBy: 'user' | 'system';
    };

export interface DeleteHistory {
  workspace: string;
  deletions: DeleteHistoryEntry[];
}