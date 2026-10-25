import { randomUUID } from 'node:crypto';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { IFileMutationJournal } from '../../BrudFileSystem/events/types.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';
import type { IUniversalHistory } from '../contracts/IUniversalHistory.js';
import type {
  Checkpoint,
  HistoryEntry,
  HistoryQueryFilter,
  RollbackReport,
} from '../contracts/models.js';
import { RollbackEngine } from '../engine/RollbackEngine.js';
import { JournalSubscriber } from '../listener/JournalSubscriber.js';
import type { SqliteHistoryStorage } from '../storage/SqliteHistoryStorage.js';

/** Session attributed to mutations recorded before `beginSession`. */
export const DEFAULT_HISTORY_SESSION_ID = 'default';

/** Clock injection point returning epoch milliseconds. */
export type HistoryEpochClock = () => number;

/** Construction options for {@link UniversalHistory}. */
export interface UniversalHistoryOptions {
  /** Durable SQLite ledger. */
  readonly storage: SqliteHistoryStorage;

  /** Workspace filesystem used to read snapshots and apply reversals. */
  readonly fileSystem: IBrudFileSystem;

  /** Filesystem mutation journal to consume. */
  readonly journal?: IFileMutationJournal;

  /** Clock override for deterministic tests. */
  readonly now?: HistoryEpochClock;

  /** Receives background ingestion failures. */
  readonly onIngestionError?: (error: unknown) => void;
}

function settleJournalQueue(): Promise<void> {
  return new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Journal-driven universal history service.
 *
 * The service is a thin coordinator: {@link JournalSubscriber} persists
 * mutations asynchronously, {@link SqliteHistoryStorage} owns the durable
 * ledger and content-addressed blobs, and {@link RollbackEngine} performs
 * drift-checked reversals through the workspace filesystem.
 */
export class UniversalHistory implements IUniversalHistory, IServiceLifecycle {
  private readonly storage: SqliteHistoryStorage;

  private readonly engine: RollbackEngine;

  private readonly subscriber: JournalSubscriber | undefined;

  private readonly now: HistoryEpochClock;

  private currentSessionId: string = DEFAULT_HISTORY_SESSION_ID;

  constructor(options: UniversalHistoryOptions) {
    this.storage = options.storage;
    this.engine = new RollbackEngine({
      storage: options.storage,
      fileSystem: options.fileSystem,
    });
    this.now = options.now ?? ((): number => Date.now());

    if (options.journal !== undefined) {
      this.subscriber = new JournalSubscriber({
        journal: options.journal,
        storage: options.storage,
        fileSystem: (): IBrudFileSystem => options.fileSystem,
        getSessionId: (): string => this.currentSessionId,
        ...(options.onIngestionError === undefined
          ? {}
          : { onError: options.onIngestionError }),
      });
      this.subscriber.start();
    }
  }

  /** Session receiving subsequent mutations. */
  get sessionId(): string {
    return this.currentSessionId;
  }

  /** Ledger storage owned by this service. */
  get ledger(): SqliteHistoryStorage {
    return this.storage;
  }

  initialize(): void {
    this.subscriber?.start();
  }

  async beginSession(
    sessionId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    if (sessionId.length === 0) {
      throw new RangeError('History session id must be a non-empty string');
    }

    await this.flush();

    const createdAt = this.now();

    this.storage.beginSession(sessionId, createdAt, metadata);
    this.currentSessionId = sessionId;
  }

  async recordCheckpoint(
    label: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    if (label.length === 0) {
      throw new RangeError('History checkpoint label must be a non-empty string');
    }

    await this.flush();

    const createdAt = this.now();
    const checkpointId = `CP-${randomUUID()}`;

    this.storage.ensureSession(this.currentSessionId, createdAt);
    this.storage.insertCheckpoint({
      checkpointId,
      label,
      timestamp: createdAt,
      sessionId: this.currentSessionId,
      ledgerOffset: this.storage.maxSequence(),
      metadata: metadata ?? {},
    });

    return checkpointId;
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<RollbackReport> {
    return this.runReversal(async (): Promise<RollbackReport> =>
      this.engine.rollbackToCheckpoint(checkpointId));
  }

  async undo(stepCount?: number): Promise<RollbackReport> {
    return this.runReversal(async (): Promise<RollbackReport> => this.engine.undo(stepCount));
  }

  async redo(stepCount?: number): Promise<RollbackReport> {
    return this.runReversal(async (): Promise<RollbackReport> => this.engine.redo(stepCount));
  }

  async getHistory(filter?: HistoryQueryFilter): Promise<HistoryEntry[]> {
    await this.flush();

    return [...this.storage.listMutations(filter)];
  }

  async getCheckpoints(sessionId?: string): Promise<Checkpoint[]> {
    await this.flush();

    return [...this.storage.listCheckpoints(sessionId)];
  }

  async dispose(): Promise<void> {
    if (this.subscriber !== undefined) {
      await this.subscriber.stop();
    }

    this.storage.close();
  }

  private async flush(): Promise<void> {
    if (this.subscriber !== undefined) {
      await this.subscriber.flush();
    }
  }

  /**
   * Applies a reversal while the subscriber is suspended.
   *
   * Reversal writes publish ordinary filesystem journal events. Suspending
   * ingestion keeps those compensating writes out of the ledger, so the
   * undo/redo cursor remains a faithful record of forward mutations. The
   * journal queue is settled before resuming so late microtasks published by
   * the last reversal write are dropped rather than recorded.
   */
  private async runReversal(operation: () => Promise<RollbackReport>): Promise<RollbackReport> {
    await this.flush();
    this.subscriber?.suspend();

    try {
      return await operation();
    } finally {
      await settleJournalQueue();
      this.subscriber?.resume();
    }
  }
}
