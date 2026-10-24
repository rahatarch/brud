import type {
  BaselineSnapshot,
  OperationKind,
  SessionStatus,
} from '../../contracts/IUniversalHistoryService/types.js';
import type { FileDelta } from '../compute_delta/types.js';

/** Operation describing one mutation performed inside a session. */
export interface ExecutionOperation {
  readonly id: string;
  readonly kind: OperationKind;
  /** Workspace-relative path targeted by the operation. */
  readonly relativePath: string;
  /** ISO 8601 timestamp; defaults to the attach timestamp. */
  readonly recordedAt?: string;
}

/** Operation with its timestamp resolved. */
export interface RecordedOperation {
  readonly id: string;
  readonly kind: OperationKind;
  readonly relativePath: string;
  readonly recordedAt: string;
}

/** Result observed for one executed operation. */
export interface ExecutionResult {
  readonly operationId: string;
  readonly success: boolean;
  readonly message?: string;
}

/** Accumulated execution state of an active history session. */
export interface SessionExecutionState {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly baseline: BaselineSnapshot;
  readonly operations: readonly RecordedOperation[];
  readonly results: readonly ExecutionResult[];
  /** Forward deltas keyed by workspace-relative path. */
  readonly deltas: Readonly<Record<string, FileDelta>>;
  readonly filesAffected: readonly string[];
  readonly updatedAt: string;
}

/** Input contract for {@link attachExecution}. */
export interface AttachExecutionInput {
  /**
   * Existing active session state, or the baseline snapshot captured when
   * the session started.
   */
  readonly session: SessionExecutionState | BaselineSnapshot;
  readonly operations: readonly ExecutionOperation[];
  readonly results?: readonly ExecutionResult[];
  readonly deltas: readonly FileDelta[];
  /** Override for the attach timestamp; defaults to the current time. */
  readonly attachedAt?: string;
}

/** Thrown when a delta batch is attached to a non-active session. */
export class InactiveSessionError extends Error {
  readonly sessionId: string;

  readonly status: SessionStatus;

  constructor(sessionId: string, status: SessionStatus) {
    super(`Session ${sessionId} is not active (status: ${status})`);
    this.name = 'InactiveSessionError';
    this.sessionId = sessionId;
    this.status = status;
  }
}
