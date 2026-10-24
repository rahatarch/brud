import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type { SqliteLedger } from '../../storage/SqliteLedger/SqliteLedger.js';
import type { ReversalTargetState } from '../../storage/SqliteLedger/types.js';

/** File state a reversal plan wants to materialize. */
export type { ReversalTargetState };

/** Mutation applied to one workspace target during a reversal. */
export type FileReversalActionKind = 'restore' | 'delete';

/** Reasons a planned reversal cannot run against the current disk state. */
export type ReversalConflictCode = 'STALE_BASELINE_CONFLICT' | 'BLOB_NOT_FOUND';

/** One workspace mutation planned by {@link planReversal}. */
export interface FileReversalAction {
  /** Workspace-relative path. */
  readonly relativePath: string;
  readonly action: FileReversalActionKind;
  /** Bytes written when the action is `'restore'`; `null` for `'delete'`. */
  readonly targetBytes: Uint8Array | null;
  /** Digest the file must currently have for the action to be safe. */
  readonly expectedCurrentSha256: string;
  /** Digest observed on disk, or `null` when the target is absent. */
  readonly actualCurrentSha256: string | null;
}

/** Blocking issue discovered while inspecting the current disk state. */
export interface ReversalConflict {
  readonly relativePath: string;
  readonly code: ReversalConflictCode;
  readonly message: string;
  /** Digest the disk was expected to match. */
  readonly expectedSha256: string;
  /** Digest observed on disk, or `null` when the target is absent. */
  readonly actualSha256: string | null;
}

/** Deterministic, side-effect-free description of a reversal. */
export interface ReversalPlan {
  readonly sessionId: string;
  readonly targetState: ReversalTargetState;
  readonly actions: readonly FileReversalAction[];
  readonly conflicts: readonly ReversalConflict[];
  /** `true` only when no conflicts were found. */
  readonly isExecutable: boolean;
}

/** Optional tuning for {@link planReversal}. */
export interface PlanReversalOptions {
  /** State to restore; defaults to `'pre'`. */
  readonly targetState?: ReversalTargetState;
}

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
