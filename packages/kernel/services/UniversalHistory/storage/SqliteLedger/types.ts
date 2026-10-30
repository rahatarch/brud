import type { LedgerQueryFilter, ReversalTargetState, SessionRow, SessionStatus } from '../../contracts/IUniversalHistoryService/types.js';

export type { LedgerQueryFilter, ReversalTargetState, SessionRow, SessionStatus };

/** Outcome persisted in `reversals.status`. */
export type ReversalStatus = 'success' | 'failed' | 'aborted';

const SESSION_STATUSES: readonly SessionStatus[] = [
  'active',
  'committed',
  'aborted',
  'reverted',
];

const REVERSAL_TARGET_STATES: readonly ReversalTargetState[] = ['pre', 'post'];

const REVERSAL_STATUSES: readonly ReversalStatus[] = ['success', 'failed', 'aborted'];

/**
 * Narrows an arbitrary string to a persisted {@link SessionStatus}.
 *
 * @param value - Candidate status.
 */
export function isSessionStatus(value: string): value is SessionStatus {
  return SESSION_STATUSES.some((candidate) => candidate === value);
}

/**
 * Narrows an arbitrary string to a persisted {@link ReversalTargetState}.
 *
 * @param value - Candidate target state.
 */
export function isReversalTargetState(value: string): value is ReversalTargetState {
  return REVERSAL_TARGET_STATES.some((candidate) => candidate === value);
}

/**
 * Narrows an arbitrary string to a persisted {@link ReversalStatus}.
 *
 * @param value - Candidate status.
 */
export function isReversalStatus(value: string): value is ReversalStatus {
  return REVERSAL_STATUSES.some((candidate) => candidate === value);
}

/** Durable row of the `session_files` table. */
export interface SessionFileRow {
  readonly id?: number;
  readonly session_id: string;
  /** Workspace-relative path; never absolute. */
  readonly relative_path: string;
  readonly pre_sha256: string;
  readonly post_sha256: string;
  readonly diff_content: string | null;
  readonly blob_sha256: string | null;
  /** `0` or `1`. */
  readonly is_binary: number;
}

/** Durable row of the `reversals` table. */
export interface ReversalRow {
  readonly reversal_id: string;
  readonly session_id: string;
  readonly target_state: ReversalTargetState;
  /** ISO 8601 UTC timestamp. */
  readonly executed_at: string;
  readonly status: ReversalStatus;
  /** Serialized JSON array of reverted operation identifiers. */
  readonly reverted_operations: string;
  readonly error_message: string | null;
}

/** Constructor options for {@link SqliteLedger}. */
export interface SqliteLedgerOptions {
  /** `:memory:` or an absolute path to a database file. */
  readonly dbPath: string;
}

/** Timestamps used when soft-deleting a session. */
export interface SoftDeleteOptions {
  readonly deletedAt: string;
  readonly expiresAt: string;
}

/** Session payload accepted by {@link SqliteLedger.createSession}. */
export type SessionInsertRow = Omit<SessionRow, 'is_deleted' | 'deleted_at' | 'expires_at'>;

/** File payload accepted by {@link SqliteLedger.commitSession}. */
export type SessionFileInsertRow = Omit<SessionFileRow, 'id' | 'session_id'>;

/** Reversal payload accepted by {@link SqliteLedger.recordReversal}. */
export type ReversalInsertRow = ReversalRow;

/** Session plus its committed file rows. */
export interface SessionWithFiles {
  readonly session: SessionRow;
  readonly files: readonly SessionFileRow[];
}

/** Bound parameters for the session insert statement. */
export interface SessionInsertParams {
  readonly sessionId: string;
  readonly createdAt: string;
  readonly prompt: string;
  readonly status: SessionStatus;
  readonly filesAffected: string;
}

/** Bound parameters for the session file insert statement. */
export interface SessionFileInsertParams {
  readonly sessionId: string;
  readonly relativePath: string;
  readonly preSha256: string;
  readonly postSha256: string;
  readonly diffContent: string | null;
  readonly blobSha256: string | null;
  readonly isBinary: number;
}

/** Bound parameters for the reversal insert statement. */
export interface ReversalInsertParams {
  readonly reversalId: string;
  readonly sessionId: string;
  readonly targetState: ReversalTargetState;
  readonly executedAt: string;
  readonly status: ReversalStatus;
  readonly revertedOperations: string;
  readonly errorMessage: string | null;
}
