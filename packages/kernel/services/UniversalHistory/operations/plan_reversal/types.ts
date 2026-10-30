import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SqliteLedger } from '../../storage/SqliteLedger/SqliteLedger.js';
import type {
  FileReversalAction,
  FileReversalActionKind,
  PlanReversalOptions,
  ReversalConflict,
  ReversalConflictCode,
  ReversalPlan,
  ReversalTargetState,
} from '../../contracts/IUniversalHistoryService/types.js';

/** File state a reversal plan wants to materialize. */
export type {
  FileReversalAction,
  FileReversalActionKind,
  PlanReversalOptions,
  ReversalConflict,
  ReversalConflictCode,
  ReversalPlan,
  ReversalTargetState,
};

/** Input contract for {@link planReversal}. */
export interface PlanReversalInput {
  readonly ledger: SqliteLedger;
  /** Workspace-scoped filesystem, used exclusively for read operations. */
  readonly fileSystem: IBrudFileSystem;
  readonly sessionId: string;
  readonly options?: PlanReversalOptions;
}

/** Thrown when a session can no longer be reverted. */
export class SessionNotRevertibleError extends Error {
  readonly sessionId: string;

  readonly status: string;

  constructor(sessionId: string, status: string) {
    super(`Session ${sessionId} cannot be reverted (status: ${status})`);
    this.name = 'SessionNotRevertibleError';
    this.sessionId = sessionId;
    this.status = status;
  }
}
