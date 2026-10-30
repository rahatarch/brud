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

export interface CreateSessionInput {
  readonly prompt: string;
  readonly origin?: string;
  readonly implicit?: boolean;
  readonly metadata?: unknown;
  readonly now: number;
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
