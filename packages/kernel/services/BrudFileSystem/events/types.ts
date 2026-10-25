/**
 * Mutation kinds a history-capable filesystem must be able to describe.
 *
 * `patch` is declared for Phase 4 (`UniversalHistory`), which applies
 * patch-block mutations through the same journal even when the underlying
 * physical write is a staged full-file replacement.
 */
export type FileMutationOperation = 'write' | 'patch' | 'unlink' | 'mkdir';

/** Whether the descriptor was published before or after the mutation. */
export type FileMutationPhase = 'before' | 'after';

/** Physical shape of a mutation target. */
export type FileMutationNodeKind = 'missing' | 'file' | 'directory';

/**
 * Durable, path-free snapshot of a mutation target.
 *
 * `sha256` is `null` for directories and for best-effort states where the
 * content could not be read. The `size` is always the byte length for files.
 */
export interface FileMutationState {
  readonly exists: boolean;
  readonly kind: FileMutationNodeKind;
  readonly size: number;
  readonly sha256: string | null;
}

/**
 * Structured pre/post mutation descriptor.
 *
 * Paths are workspace-relative (`'/'` separators) because they are produced by
 * `WorkspaceService`. `previous` and `updated` carry the hashes a history
 * service needs to compute forward and reverse deltas without re-reading the
 * workspace.
 */
export type FileMutationCommitStatus =
  | 'committed'
  | 'committed_with_durability_warning';

export interface FileMutationEvent {
  /** Identity shared by the `before` and `after` descriptor of one mutation. */
  readonly mutationId: string;

  /** Mutation family. */
  readonly operation: FileMutationOperation;

  /** Phase this descriptor describes. */
  readonly phase: FileMutationPhase;

  /** Workspace-relative path of the mutated target. */
  readonly path: string;

  /** State observed before the mutation. */
  readonly previous: FileMutationState;

  /** Intended or observed state after the mutation. */
  readonly updated: FileMutationState;

  /** Wall-clock publication time in milliseconds. */
  readonly timestamp: number;

  /**
   * Commit outcome for an `after` descriptor.
   *
   * `committed_with_durability_warning` means the rename/link succeeded and
   * the bytes are on disk, but the containing directory could not be flushed.
   */
  readonly status?: FileMutationCommitStatus;

  /** `true` when the physical mutation is on disk. Absent on `before`. */
  readonly committed?: boolean;

  /** Failure that accompanied a durability warning. */
  readonly error?: unknown;
}

/**
 * Journal listener.
 *
 * Return values are deliberately not awaited by the filesystem: a slow or
 * failing history sink must never turn a successful mutation into a failure.
 */
export type FileMutationListener = (event: FileMutationEvent) => void | Promise<void>;

/** Optional sink for listener failures. */
export type FileMutationErrorSink = (error: unknown, event: FileMutationEvent) => void;

/**
 * Pluggable mutation journal boundary.
 *
 * Phase 4 (`UniversalHistory`) binds a listener here to build its ledger.
 * `enabled` exists so the filesystem can skip previous-state reads and hashing
 * entirely when nobody is observing mutations.
 */
export interface IFileMutationJournal {
  /** `true` when at least one listener is subscribed. */
  readonly enabled: boolean;

  /** Publishes a descriptor. Never throws into the mutation path. */
  publish(event: FileMutationEvent): void;

  /**
   * Subscribes a listener.
   *
   * @param listener - Mutation observer.
   * @returns An unsubscribe function.
   */
  subscribe(listener: FileMutationListener): () => void;
}
