import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SqliteLedger } from '../../storage/SqliteLedger/SqliteLedger.js';
import type {
  ReversalConflict,
  ReversalPlan,
  ReversalTargetState,
} from '../plan_reversal/types.js';

import type { ReversalReceipt } from '../../contracts/IUniversalHistoryService/types.js';

export type { ReversalReceipt };

/** Input contract for {@link executeReversal}. */
export interface ExecuteReversalInput {
  readonly ledger: SqliteLedger;
  readonly fileSystem: IBrudFileSystem;
  /** Plan produced by {@link planReversal}. Must be executable. */
  readonly plan: ReversalPlan;
}

/** Thrown when a plan with one or more conflicts is executed. */
export class ReversalConflictError extends Error {
  readonly sessionId: string;

  readonly conflicts: readonly ReversalConflict[];

  constructor(sessionId: string, conflicts: readonly ReversalConflict[]) {
    super(
      `Reversal for session ${sessionId} has ${conflicts.length} unresolved conflict(s)`,
    );
    this.name = 'ReversalConflictError';
    this.sessionId = sessionId;
    this.conflicts = conflicts;
  }
}

/** Thrown when a restore action carries no target bytes. */
export class MissingReversalBytesError extends Error {
  readonly relativePath: string;

  constructor(relativePath: string) {
    super(`Restore action for "${relativePath}" has no target bytes`);
    this.name = 'MissingReversalBytesError';
    this.relativePath = relativePath;
  }
}
