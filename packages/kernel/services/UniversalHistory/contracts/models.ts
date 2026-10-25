/**
 * Mutation kinds recorded by the journal-driven universal history.
 *
 * `mkdir` entries are retained for completeness and checkpoint fidelity but
 * are not reversible through {@link IUniversalHistory.undo}: the filesystem
 * surface does not expose directory removal.
 */
export type HistoryOperationKind = 'write' | 'unlink' | 'mkdir';

/**
 * One durable state transition recorded from the filesystem mutation journal.
 *
 * Hashes are lowercase hexadecimal SHA-256 digests. An empty hash denotes a
 * missing target (for example the `previousHash` of a file creation or the
 * `updatedHash` of a deletion).
 */
export interface HistoryEntry {
  /** Identity shared with the originating mutation journal event. */
  readonly mutationId: string;

  /** Wall-clock publication time in milliseconds since the Unix epoch. */
  readonly timestamp: number;

  /** Session active when the mutation was recorded. */
  readonly sessionId: string;

  /** Workspace-relative path of the mutated target. */
  readonly targetPath: string;

  /** Mutation family. */
  readonly operationKind: HistoryOperationKind;

  /** Digest of the target before the mutation, or an empty string. */
  readonly previousHash: string;

  /** Digest of the target after the mutation, or an empty string. */
  readonly updatedHash: string;

  /**
   * Content-addressed blob reference for the updated payload when the
   * snapshot exceeded the inline threshold, otherwise `null`.
   */
  readonly blobRef: string | null;

  /** Structured, non-content metadata captured from the journal event. */
  readonly metadata: Record<string, unknown>;
}

/** Named rollback marker inside a session. */
export interface Checkpoint {
  /** Stable checkpoint identifier. */
  readonly checkpointId: string;

  /** Human-readable label supplied by the caller. */
  readonly label: string;

  /** Wall-clock creation time in milliseconds since the Unix epoch. */
  readonly timestamp: number;

  /** Session the checkpoint belongs to. */
  readonly sessionId: string;

  /** Highest mutation ledger sequence visible when the checkpoint was taken. */
  readonly ledgerOffset: number;

  /** Structured caller metadata. */
  readonly metadata: Record<string, unknown>;
}

/** A file whose on-disk digest no longer matches recorded history. */
export interface DetectedDrift {
  /** Workspace-relative path that drifted. */
  readonly path: string;

  /** Digest recorded by history and expected before the rollback. */
  readonly expectedHash: string;

  /** Digest currently observed on disk. */
  readonly actualHash: string;
}

/** Terminal status of an undo, redo, or checkpoint rollback. */
export type RollbackStatus = 'success' | 'partial' | 'drift_aborted';

/** Outcome of a reversal operation. */
export interface RollbackReport {
  /** Paths whose content was restored or removed. */
  readonly restoredPaths: string[];

  /** Paths that could not be restored (missing payload or unsupported kind). */
  readonly skippedPaths: string[];

  /** Files that were modified outside recorded history. */
  readonly detectedDrift: DetectedDrift[];

  /** Overall outcome. */
  readonly status: RollbackStatus;
}

/** Filters accepted by {@link IUniversalHistory.getHistory}. */
export interface HistoryQueryFilter {
  /** Restricts results to one session. */
  readonly sessionId?: string;

  /** Restricts results to one workspace-relative target path. */
  readonly targetPath?: string;

  /** Restricts results to one mutation family. */
  readonly operationKind?: HistoryOperationKind;

  /** Inclusive lower bound over the mutation timestamp (epoch milliseconds). */
  readonly since?: number;

  /** Inclusive upper bound over the mutation timestamp (epoch milliseconds). */
  readonly until?: number;

  /** Maximum rows to return. */
  readonly limit?: number;

  /** Rows to skip before returning results. */
  readonly offset?: number;
}
