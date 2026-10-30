import type { IUniversalHistory } from '../contracts/IUniversalHistory.js';
import type {
  Checkpoint,
  HistoryEntry,
  HistoryQueryFilter,
  RollbackReport,
} from '../contracts/models.js';

/** Thrown when an unprivileged caller attempts a mutating history call. */
export class HistoryAccessDeniedError extends Error {
  readonly code = 'HISTORY_ACCESS_DENIED';

  constructor(operation: string) {
    super(`history:${operation} requires the core history orchestrator tier`);
    this.name = 'HistoryAccessDeniedError';
  }
}

/**
 * Read-only projection handed to userland and kernel-tier callers.
 *
 * Reads are delegated; rollback and session mutations are rejected so a
 * `history:read` capability cannot be escalated into `history:write`.
 *
 * The delegate lives in an ECMAScript private field, so it cannot be reached
 * at runtime even by casting, and the instance is frozen (F-C2-1).
 */
export class ReadOnlyHistoryFacade implements IUniversalHistory {
  readonly #inner: IUniversalHistory;

  constructor(inner: IUniversalHistory) {
    this.#inner = inner;
    Object.freeze(this);
  }

  beginSession(_sessionId: string, _metadata?: Record<string, unknown>): Promise<void> {
    return Promise.reject(new HistoryAccessDeniedError('beginSession'));
  }

  recordCheckpoint(_label: string, _metadata?: Record<string, unknown>): Promise<string> {
    return Promise.reject(new HistoryAccessDeniedError('recordCheckpoint'));
  }

  rollbackToCheckpoint(_checkpointId: string): Promise<RollbackReport> {
    return Promise.reject(new HistoryAccessDeniedError('rollbackToCheckpoint'));
  }

  undo(_stepCount?: number): Promise<RollbackReport> {
    return Promise.reject(new HistoryAccessDeniedError('undo'));
  }

  redo(_stepCount?: number): Promise<RollbackReport> {
    return Promise.reject(new HistoryAccessDeniedError('redo'));
  }

  getHistory(filter?: HistoryQueryFilter): Promise<HistoryEntry[]> {
    return this.#inner.getHistory(filter);
  }

  getCheckpoints(sessionId?: string): Promise<Checkpoint[]> {
    return this.#inner.getCheckpoints(sessionId);
  }
}
