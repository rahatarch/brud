import type {
  CommitOutcome,
  IUniversalHistoryService,
} from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import type {
  CommitReceipt,
  LedgerQueryFilter,
  PlanReversalOptions,
  ReversalPlan,
  ReversalReceipt,
  SessionManifest,
  SessionRow,
} from '../contracts/IUniversalHistoryService/types.js';

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

/**
 * Read-only projection of {@link IUniversalHistoryService} handed to plugins
 * without write authority.
 *
 * `getSession`, `listSessions`, and `planReversal` (pure planning) delegate.
 * `beginSession`, `commitSession`, and `executeReversal` reject with
 * {@link UniversalHistoryReadOnlyViolationError} and never reach the service.
 *
 * The delegate lives in an ECMAScript private field, so it cannot be reached
 * at runtime even by casting, and the instance is frozen.
 */
export class ReadOnlyUniversalHistoryFacade implements IUniversalHistoryService {
  readonly #inner: IUniversalHistoryService;

  constructor(inner: IUniversalHistoryService) {
    this.#inner = inner;
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
}
