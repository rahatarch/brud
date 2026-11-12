import type {
  Checkpoint,
  HistoryEntry,
  HistoryQueryFilter,
  RollbackReport,
} from './models.js';

/**
 * Deterministic, reversible audit of workspace mutations.
 *
 * Implementations consume the {@link IFileMutationJournal} published by the
 * filesystem, persist structured state transitions plus content snapshots in
 * an embedded SQLite ledger under `.brud/history/`, and reconstruct previous
 * workspace states without clobbering unrecorded external edits.
 */
export interface IUniversalHistory {
  /**
   * Opens a named audit session.
   *
   * Mutations recorded after this call are attributed to `sessionId` until a
   * different session is opened.
   *
   * @param sessionId - Caller-supplied session identifier.
   * @param metadata - Structured, non-content session metadata.
   */
  beginSession(sessionId: string, metadata?: Record<string, unknown>): Promise<void>;

  /**
   * Records a named rollback marker at the current ledger position.
   *
   * @param label - Human-readable checkpoint label.
   * @param metadata - Structured checkpoint metadata.
   * @returns The new checkpoint identifier.
   */
  recordCheckpoint(label: string, metadata?: Record<string, unknown>): Promise<string>;

  /**
   * Reverts every recorded mutation newer than the checkpoint.
   *
   * @param checkpointId - Checkpoint to restore.
   */
  rollbackToCheckpoint(checkpointId: string): Promise<RollbackReport>;

  /**
   * Reverts the newest `stepCount` reversible mutations.
   *
   * @param stepCount - Number of mutation steps to revert. Defaults to `1`.
   */
  undo(stepCount?: number): Promise<RollbackReport>;

  /**
   * Re-applies mutations previously reverted by {@link undo} or
   * {@link rollbackToCheckpoint}.
   *
   * @param stepCount - Number of mutation steps to re-apply. Defaults to `1`.
   */
  redo(stepCount?: number): Promise<RollbackReport>;

  /**
   * Lists recorded transitions newest-first.
   *
   * @param filter - Optional session, path, kind, time, and pagination filters.
   */
  getHistory(filter?: HistoryQueryFilter): Promise<HistoryEntry[]>;

  /**
   * Lists checkpoints newest-first.
   *
   * @param sessionId - Optional session restriction.
   */
  getCheckpoints(sessionId?: string): Promise<Checkpoint[]>;
}
