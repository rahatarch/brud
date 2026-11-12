import type {
  CommitOutcome,
  IUniversalHistoryService,
} from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import type {
  IPluginHistoryService,
  PluginSessionView,
  RevertOperationsOptions,
} from '../contracts/IPluginHistoryService.js';
import { isPluginHistoryService } from '../contracts/IPluginHistoryService.js';
import type {
  CommitReceipt,
  LedgerQueryFilter,
  PlanReversalOptions,
  ReversalPlan,
  ReversalReceipt,
  SessionManifest,
  SessionRow,
} from '../contracts/IUniversalHistoryService/types.js';
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

/** Thrown when a read-only universal history projection receives a mutation. */
export class UniversalHistoryReadOnlyViolationError extends Error {
  public readonly code = 'READ_ONLY_VIOLATION' as const;

  /** Name of the rejected method. */
  public readonly operation: string;

  constructor(operation: string) {
    super(`Operation "${operation}" is not permitted on a read-only universal history projection`);
    this.name = 'UniversalHistoryReadOnlyViolationError';
    this.operation = operation;
  }
}

/** Thrown when the wrapped service predates the Phase 3A plugin contract. */
export class UniversalHistoryPluginContractError extends Error {
  public readonly code = 'PLUGIN_HISTORY_CONTRACT_UNAVAILABLE' as const;

  constructor(operation: string) {
    super(`Operation "${operation}" requires a universal history service that implements the plugin contract`);
    this.name = 'UniversalHistoryPluginContractError';
  }
}

/**
 * Read-only projection of {@link IPluginHistoryService} handed to plugins
 * without write authority.
 *
 * `getSession`, `listSessions`, `planReversal`, `getSessionView`,
 * `listDeleteHistory`, and `planOperationReversal` (pure planning) delegate.
 * `beginSession`, `commitSession`, `executeReversal`, `trashSession`,
 * `restoreSession`, `deleteSessionPermanently`, `wipeAllSessions`,
 * `revertOperations`, and `deleteAuditLog` reject with
 * {@link UniversalHistoryReadOnlyViolationError} and never reach the service.
 *
 * The delegate lives in an ECMAScript private field, so it cannot be reached
 * at runtime even by casting, and the instance is frozen.
 */
export class ReadOnlyUniversalHistoryFacade implements IPluginHistoryService {
  readonly #inner: IUniversalHistoryService;
  readonly #pluginInner: IPluginHistoryService | undefined;

  constructor(inner: IUniversalHistoryService) {
    this.#inner = inner;
    this.#pluginInner = isPluginHistoryService(inner) ? inner : undefined;
    Object.freeze(this);
  }

  beginSession(_prompt: string, _declaredTargets?: readonly string[]): Promise<string> {
    return Promise.reject(new UniversalHistoryReadOnlyViolationError('beginSession'));
  }

  commitSession(_sessionId: string, _outcome: CommitOutcome): Promise<CommitReceipt> {
    return Promise.reject(new UniversalHistoryReadOnlyViolationError('commitSession'));
  }

  planReversal(sessionId: string, options?: PlanReversalOptions): Promise<ReversalPlan> {
    return this.#inner.planReversal(sessionId, options);
  }

  executeReversal(_plan: ReversalPlan): Promise<ReversalReceipt> {
    return Promise.reject(new UniversalHistoryReadOnlyViolationError('executeReversal'));
  }

  getSession(sessionId: string): Promise<SessionManifest | null> {
    return this.#inner.getSession(sessionId);
  }

  listSessions(filter?: LedgerQueryFilter): Promise<readonly SessionRow[]> {
    return this.#inner.listSessions(filter);
  }

  // ── read surface (Phase 3A) ────────────────────────────────────────

  getSessionView(sessionId: string): PluginSessionView | undefined {
    return this.#plugin('getSessionView').getSessionView(sessionId);
  }

  listDeleteHistory(query?: DeleteHistoryQuery): DeleteHistoryPage {
    return this.#plugin('listDeleteHistory').listDeleteHistory(query);
  }

  planOperationReversal(
    sessionId: string,
    operationIds: readonly (string | number)[],
    targetState: 'pre' | 'post' = 'pre',
  ): Promise<UnifiedOperationReversalPlan> {
    return this.#plugin('planOperationReversal').planOperationReversal(sessionId, operationIds, targetState);
  }

  // ── write surface (Phase 3A) ───────────────────────────────────────

  trashSession(_sessionId: string, _options?: TrashSessionOptions): SessionTrashReceipt {
    throw new UniversalHistoryReadOnlyViolationError('trashSession');
  }

  restoreSession(_sessionId: string, _options?: SessionLifecycleOptions): SessionTrashReceipt {
    throw new UniversalHistoryReadOnlyViolationError('restoreSession');
  }

  deleteSessionPermanently(
    _sessionId: string,
    _options?: SessionLifecycleOptions,
  ): SessionDeleteReceipt {
    throw new UniversalHistoryReadOnlyViolationError('deleteSessionPermanently');
  }

  wipeAllSessions(
    _confirmation: string,
    _options?: WipeSessionsOptions,
  ): Promise<WipeSessionsReceipt> {
    return Promise.reject(new UniversalHistoryReadOnlyViolationError('wipeAllSessions'));
  }

  revertOperations(
    _sessionId: string,
    _operationIds: readonly (string | number)[],
    _options?: RevertOperationsOptions,
  ): Promise<UnifiedOperationReversalReceipt> {
    return Promise.reject(new UniversalHistoryReadOnlyViolationError('revertOperations'));
  }

  deleteAuditLog(_query?: DeleteHistoryQuery): number {
    throw new UniversalHistoryReadOnlyViolationError('deleteAuditLog');
  }

  #plugin(operation: string): IPluginHistoryService {
    if (this.#pluginInner === undefined) {
      throw new UniversalHistoryPluginContractError(operation);
    }

    return this.#pluginInner;
  }
}