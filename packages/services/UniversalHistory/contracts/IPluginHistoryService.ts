/**
 * Plugin-facing history contract (Phase 3A).
 *
 * Extends the {@link IUniversalHistoryService} with the Phase 2
 * lifecycle, per-operation reversal, snapshot, and audit-log surface. The
 * projection is additive: every existing method keeps its shape, and the new
 * methods are implemented by `PluginHistoryFacade` (write authority) and
 * `ReadOnlyUniversalHistoryFacade` (read authority).
 *
 * Types intentionally use the unified engine's public shapes. Raw store rows,
 * serialized payload columns, and store handles are never exposed:
 * {@link PluginSessionView} strips `EntryRow.payloadJson`,
 * `inversePayloadJson`, and `payloadSha256`.
 */
import type { IUniversalHistoryService } from './IUniversalHistoryService/IUniversalHistoryService.js';
import type {
  DeleteHistoryPage,
  DeleteHistoryQuery,
} from '../unified/store/types.js';
import type {
  SessionDeleteReceipt,
  SessionLifecycleOptions,
  SessionTrashReceipt,
  TrashSessionOptions,
  WipeSessionsOptions,
  WipeSessionsReceipt,
} from '../unified/service/types.js';
import type {
  UnifiedOperationReversalPlan,
  UnifiedOperationReversalReceipt,
} from '../unified/engine/ReversalEngine.js';

/** Safe, plugin-facing view of one session row. */
export interface PluginSessionRow {
  readonly sessionId: string;
  readonly createdAt: number;
  readonly prompt: string;
  readonly status: 'active' | 'committed' | 'aborted' | 'reverted';
  readonly origin: string;
  readonly implicit: boolean;
  readonly closedAt: number | null;
  readonly metadata: unknown;
  readonly isDeleted: boolean;
  readonly deletedAt: number | null;
  readonly expiresAt: number | null;
}

/** Safe baseline digest captured for one declared target. */
export interface PluginTargetBaseline {
  readonly exists: boolean;
  readonly sha256: string | null;
  readonly size: number;
  readonly isBinary: boolean;
}

/** One changed target inside a plugin-facing session snapshot. */
export interface PluginSessionTarget {
  readonly seq: number;
  readonly entryId: string;
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly createdAt: number;
  /** Resolved payload; never a serialized store column. */
  readonly payload: unknown;
}

/**
 * Sanitized snapshot of one session.
 *
 * Mirrors `UnifiedSessionView` but omits the internal `EntryRow` fields
 * (`payloadJson`, `inversePayloadJson`, `payloadSha256`, `filePath`).
 */
export interface PluginSessionView {
  readonly session: PluginSessionRow;
  readonly declaredTargets: readonly string[];
  readonly baseline: Readonly<Record<string, PluginTargetBaseline>>;
  readonly targets: readonly PluginSessionTarget[];
}

/** Options for a per-operation reversal. */
export interface RevertOperationsOptions {
  /** State to restore; defaults to `'pre'`. */
  readonly targetState?: 'pre' | 'post';
}

/**
 * History surface available to official plugins through
 * `context.getUniversalHistory()`.
 *
 * `history:read` yields a read-only projection: the read methods below work and
 * every write method rejects with `READ_ONLY_VIOLATION`. `history:write` plus
 * the kernel-derived official brand yields the full surface. No plugin without
 * a history permission receives this handle at all.
 */
export interface IPluginHistoryService extends IUniversalHistoryService {
  // ── read ──────────────────────────────────────────────────────────

  /** Sanitized snapshot of one session, or `undefined` when unknown. */
  getSessionView(sessionId: string): PluginSessionView | undefined;

  /** Newest-first lifecycle audit log (trash/restore/delete/wipe). */
  listDeleteHistory(query?: DeleteHistoryQuery): DeleteHistoryPage;

  /** Plans a reversal of only the requested operations. Pure planning. */
  planOperationReversal(
    sessionId: string,
    operationIds: readonly (string | number)[],
    targetState?: 'pre' | 'post',
  ): Promise<UnifiedOperationReversalPlan>;

  // ── write ─────────────────────────────────────────────────────────

  /** Moves a completed session to the trash. */
  trashSession(sessionId: string, options?: TrashSessionOptions): SessionTrashReceipt;

  /** Returns a trashed session to normal state. */
  restoreSession(sessionId: string, options?: SessionLifecycleOptions): SessionTrashReceipt;

  /** Permanently removes one session with its entries and reversal rows. */
  deleteSessionPermanently(
    sessionId: string,
    options?: SessionLifecycleOptions,
  ): SessionDeleteReceipt;

  /** Permanently removes every session; requires the exact confirmation phrase. */
  wipeAllSessions(
    confirmation: string,
    options?: WipeSessionsOptions,
  ): Promise<WipeSessionsReceipt>;

  /** Reverses only the requested operations within a session. */
  revertOperations(
    sessionId: string,
    operationIds: readonly (string | number)[],
    options?: RevertOperationsOptions,
  ): Promise<UnifiedOperationReversalReceipt>;

  /**
   * Deletes lifecycle audit rows matching the filter and returns the count.
   *
   * This is a distinct capability: the kernel previously only offered
   * `listDeleteHistory`. The deletion is not itself audited, otherwise the log
   * would immediately repopulate. `limit`/`after` from the query are ignored
   * because they are listing cursors, not deletion selectors.
   */
  deleteAuditLog(query?: DeleteHistoryQuery): number;
}

/**
 * Narrows a value to {@link IPluginHistoryService} at runtime.
 *
 * Used by the plugin context to reject a provider that does not implement the
 * full contract instead of exposing a partially working handle.
 */
export function isPluginHistoryService(
  value: IUniversalHistoryService,
): value is IPluginHistoryService {
  const candidate = value as Partial<IPluginHistoryService>;

  return typeof candidate.getSessionView === 'function'
    && typeof candidate.listDeleteHistory === 'function'
    && typeof candidate.planOperationReversal === 'function'
    && typeof candidate.trashSession === 'function'
    && typeof candidate.restoreSession === 'function'
    && typeof candidate.deleteSessionPermanently === 'function'
    && typeof candidate.wipeAllSessions === 'function'
    && typeof candidate.revertOperations === 'function'
    && typeof candidate.deleteAuditLog === 'function';
}