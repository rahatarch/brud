/**
 * History parity oracle — engine-neutral subject contract (D-15, increment U-P).
 *
 * The oracle scenarios talk only to this interface. Each history engine gets
 * one adapter (a "subject") that drives a real, booted kernel on a temporary
 * on-disk workspace and maps engine-specific results into the normalized
 * shapes below. The same scenarios must pass on the legacy engines (today)
 * and on the unified engine (U-4/U-6) without being edited.
 */
import type { IBrudFileSystem } from '../../../services/BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';

export type OracleSessionStatus = 'active' | 'committed' | 'aborted' | 'reverted';

export type OracleErrorKind =
  | 'SESSION_NOT_FOUND'
  | 'SESSION_NOT_REVERTIBLE'
  | 'SESSION_INACTIVE'
  | 'PLAN_NOT_EXECUTABLE'
  | 'HISTORY_DEGRADED'
  | 'PROTECTED_PATH_DENIED'
  | 'OTHER';

export interface OracleCommitReceipt {
  readonly committedFileCount: number;
}

export interface OracleSession {
  readonly sessionId: string;
  readonly status: OracleSessionStatus;
  readonly filesAffected: readonly string[];
  /** SHA-256 per path before the session, or null when the file did not exist. */
  readonly preDigests: Readonly<Record<string, string | null>>;
  /** SHA-256 per path after the session, or null when the file was removed. */
  readonly postDigests: Readonly<Record<string, string | null>>;
  readonly reversalCount: number;
}

export interface OracleSessionRow {
  readonly sessionId: string;
  readonly status: OracleSessionStatus;
}

export interface OracleReversalPlan {
  readonly targetState: 'pre' | 'post';
  readonly isExecutable: boolean;
  readonly actions: readonly { readonly path: string; readonly action: 'restore' | 'delete' }[];
  readonly conflicts: readonly { readonly path: string; readonly code: string }[];
  /** Engine-native plan, passed back unchanged to {@link HistoryOracleSubject.executeReversal}. */
  readonly native: unknown;
}

export interface OracleReversalReceipt {
  readonly filesRestored: number;
  readonly filesDeleted: number;
}

export type OracleFileOperation = 'write' | 'unlink' | 'mkdir';

export interface OracleFileEntry {
  readonly path: string;
  readonly operation: OracleFileOperation;
  /** '' when the file did not exist before the mutation. */
  readonly previousHash: string;
  /** '' when the file does not exist after the mutation. */
  readonly updatedHash: string;
}

export type OracleRollbackStatus =
  | 'success'
  | 'partial'
  | 'drift_aborted'
  | 'payload_missing'
  | 'payload_corrupt';

export interface OracleRollbackReport {
  readonly status: OracleRollbackStatus;
  readonly restoredPaths: readonly string[];
  readonly skippedPaths: readonly string[];
  readonly corruptedPaths: readonly string[];
  readonly detectedDrift: readonly {
    readonly path: string;
    readonly expectedHash: string;
    readonly actualHash: string;
  }[];
}

export interface OracleWarning {
  readonly message: string;
  readonly code?: string;
  readonly reason?: string;
}

export interface HistoryOracleSubject {
  /** Absolute path of the temporary workspace this subject booted. */
  readonly workspaceRoot: string;

  /** Kernel filesystem as a core caller; every write flows through history. */
  readonly fs: IBrudFileSystem;

  /** Diagnostics the kernel logged through its logger. */
  readonly warnings: readonly OracleWarning[];

  // ── Session history (daemon `history.*` surface) ────────────────────
  beginSession(prompt: string, declaredTargets?: readonly string[]): Promise<string>;
  commitSession(sessionId: string, outcome: 'completed' | 'aborted'): Promise<OracleCommitReceipt>;
  getSession(sessionId: string): Promise<OracleSession | null>;
  listSessions(filter?: { readonly status?: OracleSessionStatus; readonly limit?: number }): Promise<readonly OracleSessionRow[]>;
  planReversal(sessionId: string, targetState?: 'pre' | 'post'): Promise<OracleReversalPlan>;
  executeReversal(plan: OracleReversalPlan): Promise<OracleReversalReceipt>;

  // ── Mutation history (undo / redo / checkpoints) ────────────────────
  /** Groups following automatic file recording under a named session. */
  openRecordingSession(name: string): Promise<void>;
  /** Waits until every mutation published so far is durable in history. */
  settle(): Promise<void>;
  /** File mutation entries, newest first. */
  listFileEntries(filter?: { readonly path?: string; readonly operation?: OracleFileOperation }): Promise<readonly OracleFileEntry[]>;
  recordCheckpoint(label: string): Promise<string>;
  rollbackToCheckpoint(checkpointId: string): Promise<OracleRollbackReport>;
  undo(steps?: number): Promise<OracleRollbackReport>;
  redo(steps?: number): Promise<OracleRollbackReport>;

  // ── Fault injection and inspection (disk level, bypasses history) ──
  /** Writes a workspace file directly on disk, outside the kernel. */
  writeExternally(relativePath: string, data: string | Uint8Array): Promise<void>;
  /** Deletes every stored copy of the content with this digest. Returns copies removed. */
  removeStoredContent(sha256: string): Promise<number>;
  /** Overwrites every stored copy of the content with this digest. Returns copies changed. */
  corruptStoredContent(sha256: string): Promise<number>;
  /** Absolute paths of the history database files, for size checks. */
  historyDatabaseFiles(): Promise<readonly string[]>;

  /** Maps an engine error to an engine-neutral kind. */
  classifyError(error: unknown): OracleErrorKind;

  dispose(): Promise<void>;
}

export interface HistoryOracleSubjectOptions {
  /** Pre-create `.brud/history` read-only before boot (degraded mode). */
  readonly readOnlyHistoryDirectory?: boolean;
  /** Reuse an existing workspace instead of creating a fresh one. */
  readonly workspaceRoot?: string;
}

export type HistoryOracleSubjectFactory = (
  options?: HistoryOracleSubjectOptions,
) => Promise<HistoryOracleSubject>;
