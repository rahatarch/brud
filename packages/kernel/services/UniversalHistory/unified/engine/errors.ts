/** Errors raised by the unified reversal engine (D-15, U-4). */

export class UnifiedCheckpointNotFoundError extends Error {
  public readonly code = 'CHECKPOINT_NOT_FOUND' as const;

  constructor(public readonly checkpointId: string) {
    super(`History checkpoint not found: ${checkpointId}`);
    this.name = 'UnifiedCheckpointNotFoundError';
  }
}

/** The session is not in a revertible state (only committed sessions are). */
export class UnifiedSessionNotRevertibleError extends Error {
  public readonly code = 'SESSION_NOT_REVERTIBLE' as const;

  constructor(public readonly sessionId: string, public readonly status: string) {
    super(`Session ${sessionId} cannot be reverted (status: ${status})`);
    this.name = 'UnifiedSessionNotRevertibleError';
  }
}

export interface UnifiedReversalConflict {
  readonly code: 'STALE_BASELINE_CONFLICT' | 'BLOB_NOT_FOUND' | 'REVERTER_UNAVAILABLE' | 'INVERSE_PAYLOAD_INVALID' | 'HANDLER_CONFLICT';
  readonly message: string;
  readonly path?: string;
  readonly seq?: number;
  readonly expectedSha256?: string | null;
  readonly actualSha256?: string | null;
}

/** A plan with conflicts, or a plan whose preconditions changed since planning, was executed. */
export class UnifiedReversalConflictError extends Error {
  public readonly code = 'REVERSAL_CONFLICT' as const;

  constructor(public readonly sessionId: string, public readonly conflicts: readonly UnifiedReversalConflict[]) {
    super(`Reversal of ${sessionId} has ${conflicts.length} conflict(s) and was not executed`);
    this.name = 'UnifiedReversalConflictError';
  }
}
