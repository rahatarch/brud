/** Public types of the unified history service (D-15, U-3). */
import type { EntryPage, EntryQuery, EntryRow, SessionRow } from '../store/types.js';

/** Context handed to reversal callbacks. Carries no service handles. */
export interface ReversalContext {
  readonly signal: AbortSignal;
}

/** Read-only view of an entry given to reversal callbacks. */
export interface EntryView {
  readonly seq: number;
  readonly entryId: string;
  readonly sessionId: string;
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly inversePayload: unknown;
  readonly createdAt: number;
}

export interface ReversalConflictReport {
  readonly code: string;
  readonly message: string;
}

export type EntryReversal =
  | { readonly mode: 'none' }
  | { readonly mode: 'inverse-payload'; apply(inversePayload: unknown, context: ReversalContext): Promise<void> }
  | {
      readonly mode: 'handler';
      detectConflict(entry: EntryView): Promise<ReversalConflictReport | null>;
      revert(entry: EntryView, context: ReversalContext): Promise<void>;
    };

export interface EntryTypeRegistration {
  /** Local type name; the full id is `${namespace}.${type}`. */
  readonly type: string;
  readonly schemaVersion: number;
  readonly payloadSchema: unknown;
  readonly reversal: EntryReversal;
}

export interface EntryRecordInput {
  readonly type: string;
  readonly schemaVersion: number;
  readonly payload: unknown;
  readonly inversePayload?: unknown;
}

export interface Disposable {
  dispose(): void;
}

export interface TargetBaseline {
  readonly exists: boolean;
  readonly sha256: string | null;
  readonly size: number;
  readonly isBinary: boolean;
}

/** Metadata persisted on explicit sessions. */
export interface SessionMetadata {
  readonly declaredTargets: readonly string[];
  readonly baseline: Readonly<Record<string, TargetBaseline>>;
}

export interface UnifiedCommitReceipt {
  readonly sessionId: string;
  readonly committedFileCount: number;
  readonly blobs: readonly { readonly sha256: string; readonly relativePath: string }[];
}

export interface UnifiedSessionView {
  readonly session: SessionRow;
  readonly declaredTargets: readonly string[];
  readonly baseline: Readonly<Record<string, TargetBaseline>>;
  /** Changed targets recorded at commit. */
  readonly targets: readonly { readonly entry: EntryRow; readonly payload: unknown }[];
}

/** A plugin-facing handle bound to one namespace. */
export interface NamespaceHistoryHandle {
  readonly namespace: string;
  registerEntryType(registration: EntryTypeRegistration): Disposable;
  beginSession(prompt: string): Promise<string>;
  recordEntry(sessionId: string, entry: EntryRecordInput): Promise<number>;
  commitSession(sessionId: string, outcome: 'completed' | 'aborted'): Promise<void>;
  getSession(sessionId: string): SessionRow | undefined;
  listSessions(limit?: number): readonly SessionRow[];
  listEntries(query?: Omit<EntryQuery, 'namespace' | 'path'>): EntryPage;
  resolvePayload(entry: EntryRow): Promise<unknown>;
}
