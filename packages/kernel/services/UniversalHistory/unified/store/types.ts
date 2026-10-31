/**
 * Row and query types of the unified history store (D-15, U-2).
 */

/** Status names exactly as persisted (legacy-compatible spelling). */
export type PersistedSessionStatus = 'active' | 'committed' | 'aborted' | 'reverted';

export type ReversalMode = 'none' | 'inverse-payload' | 'handler';

export type ReversalKind = 'session' | 'undo' | 'redo' | 'checkpoint';

export type HistoryDegradedReason = 'READ_ONLY_STORAGE' | 'SCHEMA_TOO_NEW';

export interface HistoryStoreWarning {
  readonly code: 'HISTORY_DEGRADED';
  readonly reason: HistoryDegradedReason;
  readonly message: string;
}

export type StoreOpenResult =
  | { readonly mode: 'writable' }
  | { readonly mode: 'degraded'; readonly reason: HistoryDegradedReason };

export interface EntryTypeRow {
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  /** Canonical (sorted-key) JSON text of the payload schema. */
  readonly payloadSchema: string;
  readonly reversalMode: ReversalMode;
  readonly registeredBy: string;
  readonly registeredAt: number;
}

export interface SessionRow {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly prompt: string;
  readonly status: PersistedSessionStatus;
  readonly origin: string;
  readonly implicit: boolean;
  readonly closedAt: number | null;
  readonly metadata: unknown;
}

/**
 * Liveness of the process publishing an implicit session (U-8 corrective, RL).
 *
 * Carried in `sessions.metadata` under `$.brudHistoryClaim`: no schema change
 * (D-RL1), and the retention predicate reads only `alive`/`releasedAt`
 * structurally (never as text). `nonce` is 32 hex characters, never 64, so the
 * GC's 64-hex content-reference scan never picks it up.
 */
export interface HistoryClaimInput {
  /** Owning process id. A hint for the reducer; never matched by the predicate. */
  readonly pid: number;
  /** Random 32-hex identity of this claim. */
  readonly nonce: string;
  /** Publication time (diagnostic; eligibility never uses an age rule). */
  readonly createdAt: number;
  /**
   * Pid of this kernel's chained liveness helper (RL §3.3, rung 2). Absent when
   * the helper could not be spawned; the claim is then judged by `pid` alone.
   */
  readonly helperPid?: number;
}

/** Marker written to and removed from a row's claim. */
export const HISTORY_CLAIM_KEY = 'brudHistoryClaim';

/** How the deleting process decides that a claim's owner is gone. */
export type ClaimLiveness =
  /** Liveness is evaluated in SQL by the connection's own `uh_claim_alive(pid)` function. */
  | 'native'
  /** Liveness is supplied by the caller (the service's helper map). */
  | ((pid: number) => boolean);

export interface CreateSessionInput {
  readonly prompt: string;
  readonly origin?: string;
  readonly implicit?: boolean;
  readonly metadata?: unknown;
  readonly now: number;
  /** Claim published atomically by the same `INSERT` (implicit rows only). */
  readonly claim?: HistoryClaimInput;
}

export interface SessionQuery {
  readonly status?: PersistedSessionStatus;
  readonly limit?: number;
  /** Keyset cursor: return sessions strictly older than this one. */
  readonly before?: { readonly createdAt: number; readonly sessionId: string };
  readonly includeImplicit?: boolean;
  /** Include soft-deleted sessions (legacy wire filter). */
  readonly includeDeleted?: boolean;
  /** Inclusive lower bound on `createdAt`, epoch ms (legacy wire filter). */
  readonly since?: number;
  /** Rows to skip (legacy wire contract only; prefer `before`). */
  readonly offset?: number;
}

export interface SessionPage {
  readonly rows: readonly SessionRow[];
  readonly next?: { readonly createdAt: number; readonly sessionId: string };
}

export interface ContentRef {
  readonly sha256: string;
  readonly size: number;
  readonly stored: 'inline' | 'blob';
}

/** Entry ready to append: payload already serialized and, if large, offloaded. */
export interface PreparedEntry {
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly payloadJson: string | null;
  readonly payloadSha256: string | null;
  readonly inversePayloadJson: string | null;
  readonly createdAt: number;
}

export interface EntryInput {
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly inversePayload?: unknown;
  readonly createdAt: number;
}

export interface EntryRow {
  readonly seq: number;
  readonly entryId: string;
  readonly sessionId: string;
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly payloadJson: string | null;
  readonly payloadSha256: string | null;
  readonly inversePayloadJson: string | null;
  readonly createdAt: number;
  readonly filePath: string | null;
}

export interface EntryQuery {
  readonly sessionId?: string;
  readonly namespace?: string;
  readonly type?: string;
  readonly path?: string;
  readonly afterSeq?: number;
  readonly beforeSeq?: number;
  readonly order?: 'asc' | 'desc';
  readonly limit?: number;
}

export interface EntryPage {
  readonly rows: readonly EntryRow[];
  /** Pass as `afterSeq` (asc) or `beforeSeq` (desc) to read the next page. */
  readonly nextSeq?: number;
}

export interface AppendOptions {
  /** Delete `brud.core.file` entries above the undo cursor first (a new mutation after undo). */
  readonly truncateRedoTail?: boolean;
  /** Move the undo cursor to the last appended entry. */
  readonly advanceCursor?: boolean;
}

export interface CheckpointRow {
  readonly checkpointId: string;
  readonly sessionId: string;
  readonly label: string;
  readonly seqOffset: number;
  readonly createdAt: number;
  readonly metadata: unknown;
}

export interface ReversalRow {
  readonly reversalId: string;
  readonly sessionId: string | null;
  readonly kind: ReversalKind;
  readonly targetState: string | null;
  readonly executedAt: number;
  readonly status: string;
  readonly revertedEntries: readonly number[];
  readonly errorMessage: string | null;
}

export interface ImportRow {
  readonly source: string;
  readonly sourceSha256: string;
  readonly importedAt: number;
  readonly rows: number;
}

/** Retention policy for {@link UnifiedHistoryStore.applyRetention} (D-15 U-8). */
export interface RetentionPolicy {
  /** Epoch ms; history older than this may be removed. */
  readonly cutoffMs: number;
  /** Newest file entries always kept for undo. */
  readonly minUndoEntries: number;
  /** Implicit session of the running boot; its row is never removed. */
  readonly keepSessionId?: string;
  /** Most file entries removed per run (default 50,000). */
  readonly maxEntriesPerRun?: number;
  /** File entries per transaction (default 2,000). */
  readonly batchSize?: number;
  /**
   * Reducer for claims owned by other processes (RL §3.3). Absent: a claim is
   * honoured as written, so a killed owner's row waits for its own next boot.
   */
  readonly claimLiveness?: ClaimLiveness;
}

/** Outcome of one retention run. */
export interface RetentionReport {
  readonly fileEntriesRemoved: number;
  readonly entriesRemoved: number;
  readonly sessionsRemoved: number;
  readonly checkpointsRemoved: number;
  readonly reversalsRemoved: number;
  /** File entries below this seq were eligible in the last batch. */
  readonly cut: number;
  /** `true` when the per-run budget left eligible history for the next run. */
  readonly truncated: boolean;
}

