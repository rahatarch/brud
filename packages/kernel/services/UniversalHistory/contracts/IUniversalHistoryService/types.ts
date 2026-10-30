/**
 * Identifier assigned to a universal history session.
 *
 * The formatted template mirrors the allocator output (`BR-YYYYMMDD-NNN`)
 * while remaining a plain string at runtime, so it can be serialized
 * directly into manifests without any unsafe casts.
 */
export type SessionId = `BR-${string}`;

/** Canonical session identifier shape produced by {@link SessionId}. */
export const SESSION_ID_PATTERN = /^BR-\d{8}-\d{3,4}$/;

/**
 * Narrows an arbitrary string to a {@link SessionId}.
 *
 * @param value - Candidate identifier.
 * @returns `true` when the value matches the canonical session format.
 */
export function isSessionId(value: string): value is SessionId {
  return SESSION_ID_PATTERN.test(value);
}

/** Every mutation kind the universal history ledger can describe. */
export type OperationKind =
  | 'create_file'
  | 'delete_file'
  | 'modify_file'
  | 'rename_file'
  | 'create_directory'
  | 'delete_directory';

/**
 * Content digest captured for a single workspace target.
 *
 * `sha256` is the lowercase hexadecimal SHA-256 of the raw bytes, or an
 * empty string when the target did not exist at capture time.
 */
export interface TargetDigest {
  relativePath: string;
  sha256: string;
  sizeBytes: number;
  isBinary: boolean;
  exists: boolean;
}

/** Materialized baseline payload for one target. */
export interface BaselineTarget {
  content?: Uint8Array;
  text?: string;
  digest: TargetDigest;
}

/** Complete pre-mutation snapshot of a set of workspace targets. */
export interface BaselineSnapshot {
  sessionId: string;
  capturedAt: string;
  targets: Record<string, BaselineTarget>;
}

/** Lifecycle status of a session manifest. */
export type SessionStatus = 'active' | 'committed' | 'aborted' | 'reverted';

/** Durable metadata describing one history session. */
export interface SessionManifest {
  schemaVersion: 1;
  sessionId: string;
  createdAt: string;
  prompt: string;
  status: SessionStatus;
  filesAffected: readonly string[];
  preDigests: Record<string, TargetDigest>;
  postDigests: Record<string, TargetDigest>;
  revertRecordIds?: readonly string[];
  isDeleted?: boolean;
  deletedAt?: string;
  expiresAt?: string;
}

// ── Shared contract types (moved from the legacy engine modules, D-15 U-6) ──

/** File state targeted by a reversal. */
export type ReversalTargetState = 'pre' | 'post';

/** One blob written to content-addressed storage during a commit. */
export interface CasBlobWrite {
  readonly sha256: string;
  /** Workspace-relative CAS path. */
  readonly relativePath: string;
}

/** Result of a successful atomic session commit. */
export interface CommitReceipt {
  readonly sessionId: string;
  readonly committedFileCount: number;
  /** ISO 8601 UTC timestamp. */
  readonly committedAt: string;
  readonly blobs: readonly CasBlobWrite[];
}

/** Audit record emitted by a successful reversal. */
export interface ReversalReceipt {
  readonly reversalId: string;
  readonly sessionId: string;
  readonly targetState: ReversalTargetState;
  /** ISO 8601 UTC timestamp. */
  readonly executedAt: string;
  readonly filesRestored: number;
  readonly filesDeleted: number;
}

/** Mutation applied to one workspace target during a reversal. */
export type FileReversalActionKind = 'restore' | 'delete';

/** Reasons a planned reversal cannot run against the current disk state. */
export type ReversalConflictCode = 'STALE_BASELINE_CONFLICT' | 'BLOB_NOT_FOUND';

/** One workspace mutation planned by a reversal. */
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

/** Optional tuning for planning a reversal. */
export interface PlanReversalOptions {
  /** State to restore; defaults to `'pre'`. */
  readonly targetState?: ReversalTargetState;
}

/** One session row as listed through the history contract. */
export interface SessionRow {
  readonly session_id: string;
  /** ISO 8601 UTC timestamp. */
  readonly created_at: string;
  readonly prompt: string;
  readonly status: SessionStatus;
  /** Serialized JSON array of workspace-relative paths. */
  readonly files_affected: string;
  /** `0` or `1`. */
  readonly is_deleted: number;
  readonly deleted_at: string | null;
  readonly expires_at: string | null;
}

/** Filters accepted by `listSessions`. */
export interface LedgerQueryFilter {
  /** When `true`, soft-deleted sessions are included. Defaults to `false`. */
  readonly includeDeleted?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly status?: SessionStatus;
  /** Inclusive lower bound over `sessions.created_at`. */
  readonly since?: string;
}
