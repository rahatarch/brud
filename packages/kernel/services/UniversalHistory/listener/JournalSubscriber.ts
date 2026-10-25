import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  FileMutationEvent,
  FileMutationListener,
  FileMutationOperation,
  IFileMutationJournal,
} from '../../BrudFileSystem/events/types.js';
import type { HistoryOperationKind } from '../contracts/models.js';
import { sha256Hex } from '../storage/hash.js';
import type {
  MutationRecord,
  SqliteHistoryStorage,
} from '../storage/SqliteHistoryStorage.js';

/** Paths owned by the history subsystem itself are never recorded. */
const DEFAULT_IGNORED_PREFIXES: readonly string[] = ['.brud/history'];

/** Construction options for {@link JournalSubscriber}. */
export interface JournalSubscriberOptions {
  /** Journal published by the filesystem service. */
  readonly journal: IFileMutationJournal;

  /** Durable ledger receiving structured transitions. */
  readonly storage: SqliteHistoryStorage;

  /** Resolves the workspace filesystem used to capture payload snapshots. */
  readonly fileSystem: () => IBrudFileSystem;

  /** Returns the session attribution for newly observed mutations. */
  readonly getSessionId: () => string;

  /** Additional workspace-relative prefixes that must not be recorded. */
  readonly ignoredPathPrefixes?: readonly string[];

  /** Receives ingestion failures without affecting the mutation path. */
  readonly onError?: (error: unknown, event?: FileMutationEvent) => void;
}

function isIgnoredPath(path: string, prefixes: readonly string[]): boolean {
  const normalized = path
    .replace(/\\/gu, '/')
    .replace(/^(?:\.\/)+/u, '')
    .replace(/\/+$/u, '')
    .toLowerCase();

  return prefixes.some((prefix) => {
    const normalizedPrefix = prefix.replace(/\\/gu, '/').replace(/\/+$/u, '').toLowerCase();

    return normalized === normalizedPrefix || normalized.startsWith(`${normalizedPrefix}/`);
  });
}

function toOperationKind(operation: FileMutationOperation): HistoryOperationKind | null {
  if (operation === 'write' || operation === 'patch') {
    return 'write';
  }

  if (operation === 'unlink') {
    return 'unlink';
  }

  if (operation === 'mkdir') {
    return 'mkdir';
  }

  return null;
}

/**
 * Buffers filesystem mutation descriptors and persists them asynchronously.
 *
 * The subscription callback never awaits I/O: journal publications are queued
 * in order on a promise tail. `before` descriptors start a best-effort capture
 * of the pre-mutation payload so a first overwrite of a file that predates the
 * ledger can still be reversed; `after` descriptors persist the transition
 * together with the post-mutation snapshot.
 */
export class JournalSubscriber {
  private readonly journal: IFileMutationJournal;

  private readonly storage: SqliteHistoryStorage;

  private readonly resolveFileSystem: () => IBrudFileSystem;

  private readonly getSessionId: () => string;

  private readonly onError: (error: unknown, event?: FileMutationEvent) => void;

  private readonly ignoredPrefixes: readonly string[];

  private readonly captures = new Map<string, Promise<void>>();

  private tail: Promise<void> = Promise.resolve();

  private pending = 0;

  private unsubscribe: (() => void) | undefined;

  private suspended = false;

  constructor(options: JournalSubscriberOptions) {
    this.journal = options.journal;
    this.storage = options.storage;
    this.resolveFileSystem = options.fileSystem;
    this.getSessionId = options.getSessionId;
    this.onError = options.onError ?? (() => undefined);
    this.ignoredPrefixes = [
      ...DEFAULT_IGNORED_PREFIXES,
      ...(options.ignoredPathPrefixes ?? []),
    ];
  }

  /** Whether the subscriber is receiving journal events. */
  get isStarted(): boolean {
    return this.unsubscribe !== undefined;
  }

  /** Whether recording is currently suspended (during rollback). */
  get isSuspended(): boolean {
    return this.suspended;
  }

  /** Subscribes to the journal. Repeated calls are no-ops. */
  start(): void {
    if (this.unsubscribe !== undefined) {
      return;
    }

    const listener: FileMutationListener = (event): void => {
      this.handleEvent(event);
    };

    this.unsubscribe = this.journal.subscribe(listener);
  }

  /** Stops receiving events and drains work already queued. */
  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.flush();
  }

  /** Suspends recording; events observed while suspended are dropped. */
  suspend(): void {
    this.suspended = true;
  }

  /** Resumes recording. */
  resume(): void {
    this.suspended = false;
  }

  /** Resolves once every queued event and pending snapshot capture settles. */
  async flush(): Promise<void> {
    // Publication itself is a queued microtask, so yield once to let every
    // descriptor already handed to the journal enter the local queue.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });

    do {
      await this.tail;
      await Promise.allSettled(Array.from(this.captures.values()));
    } while (this.pending > 0);
  }

  private handleEvent(event: FileMutationEvent): void {
    if (this.suspended || isIgnoredPath(event.path, this.ignoredPrefixes)) {
      return;
    }

    if (event.phase === 'before') {
      const previousHash = event.previous.sha256;

      if (previousHash !== null) {
        this.captures.set(event.mutationId, this.captureSnapshot(event, previousHash));
      }

      return;
    }

    if (event.committed === false) {
      return;
    }

    const sessionId = this.getSessionId();

    this.enqueue(async (): Promise<void> => {
      try {
        await this.recordAfter(event, sessionId);
      } finally {
        this.captures.delete(event.mutationId);
      }
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.pending += 1;
    this.tail = this.tail
      .then(work)
      .catch((error: unknown) => {
        this.onError(error);
      })
      .finally(() => {
        this.pending -= 1;
      });
  }

  private async captureSnapshot(
    event: FileMutationEvent,
    previousHash: string,
  ): Promise<void> {
    if (this.storage.hasContent(previousHash)) {
      return;
    }

    try {
      const fileSystem = this.resolveFileSystem();
      const bytes = await fileSystem.readFile(event.path);

      if (sha256Hex(bytes) !== previousHash) {
        return;
      }

      await this.storage.putContent(previousHash, bytes);
    } catch {
      // Best effort: a pre-mutation payload can disappear or be replaced by a
      // concurrent writer. Recording must still proceed with the hashes.
    }
  }

  private async recordAfter(event: FileMutationEvent, sessionId: string): Promise<void> {
    const operationKind = toOperationKind(event.operation);

    if (operationKind === null) {
      return;
    }

    const updatedHash = operationKind === 'mkdir'
      ? ''
      : event.updated.sha256 ?? '';
    const previousHash = operationKind === 'mkdir'
      ? ''
      : event.previous.sha256 ?? '';
    let content: Uint8Array | undefined;

    if (operationKind === 'write' && updatedHash.length > 0) {
      content = await this.readUpdatedContent(event, updatedHash);
    }

    const record: MutationRecord = await this.storage.recordMutation({
      mutationId: event.mutationId,
      sessionId,
      timestamp: event.timestamp,
      targetPath: event.path,
      operationKind,
      previousHash,
      updatedHash,
      metadata: {
        status: event.status ?? null,
        committed: event.committed ?? null,
        nodeKind: event.updated.kind,
        size: event.updated.size,
      },
      ...(content === undefined ? {} : { content }),
    });

    if (record.previousHash.length > 0) {
      await this.ensurePreviousContent(record.previousHash);
    }
  }

  private async readUpdatedContent(
    event: FileMutationEvent,
    expectedHash: string,
  ): Promise<Uint8Array | undefined> {
    try {
      const fileSystem = this.resolveFileSystem();
      const bytes = await fileSystem.readFile(event.path);
      const actualHash = sha256Hex(bytes);

      if (actualHash !== expectedHash) {
        // A concurrent writer changed the target between commit and capture.
        // The digest no longer names these bytes, so they are not stored.
        return undefined;
      }

      await this.storage.putContent(actualHash, bytes);

      return bytes;
    } catch {
      return undefined;
    }
  }

  private async ensurePreviousContent(previousHash: string): Promise<void> {
    if (this.storage.hasContent(previousHash)) {
      return;
    }

    try {
      const content = await this.storage.getContent(previousHash);

      if (content !== null) {
        await this.storage.putContent(previousHash, content);
      }
    } catch {
      // Missing historical payloads surface as skipped rollback paths.
    }
  }
}
