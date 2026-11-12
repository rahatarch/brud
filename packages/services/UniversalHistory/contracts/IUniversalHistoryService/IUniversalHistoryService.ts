import type {
  CommitReceipt,
  LedgerQueryFilter,
  PlanReversalOptions,
  ReversalPlan,
  ReversalReceipt,
  SessionManifest,
  SessionRow,
} from './types.js';

/** Outcome accepted when finalizing a session. */
export type CommitOutcome = 'completed' | 'aborted';

/**
 * High-integrity transactional history and reversal ledger service.
 *
 * Implementations persist byte-safe baselines, session manifests, and
 * monotonic identifiers through {@link IBrudFileSystem}. Every path handled
 * by this service is workspace-relative.
 */
export interface IUniversalHistoryService {
  /**
   * Opens a session and captures the pre-mutation baseline of every declared
   * target.
   *
   * @param prompt - Prompt describing the session's intent.
   * @param declaredTargets - Workspace-relative paths expected to mutate.
   * @returns The allocated session identifier.
   */
  beginSession(prompt: string, declaredTargets?: readonly string[]): Promise<string>;

  /**
   * Finalizes a session.
   *
   * A `'completed'` session persists its forward deltas, including binary CAS
   * blobs. An `'aborted'` session is closed without persisting file rows.
   *
   * @param sessionId - Session to finalize.
   * @param outcome - Final session outcome.
   * @returns The commit receipt describing persisted rows and blobs.
   */
  commitSession(sessionId: string, outcome: CommitOutcome): Promise<CommitReceipt>;

  /**
   * Builds a deterministic, side-effect-free reversal plan.
   *
   * @param sessionId - Session to reverse.
   * @param options - Target state and planning options.
   */
  planReversal(sessionId: string, options?: PlanReversalOptions): Promise<ReversalPlan>;

  /**
   * Applies an executable reversal plan to the workspace.
   *
   * @param plan - Plan produced by {@link IUniversalHistoryService.planReversal}.
   */
  executeReversal(plan: ReversalPlan): Promise<ReversalReceipt>;

  /**
   * Resolves a session manifest.
   *
   * @param sessionId - Session to inspect.
   * @returns The manifest, or `null` when the session is unknown.
   */
  getSession(sessionId: string): Promise<SessionManifest | null>;

  /**
   * Lists durable session rows newest-first.
   *
   * @param filter - Optional soft-delete, status, time, and pagination filters.
   */
  listSessions(filter?: LedgerQueryFilter): Promise<readonly SessionRow[]>;
}
