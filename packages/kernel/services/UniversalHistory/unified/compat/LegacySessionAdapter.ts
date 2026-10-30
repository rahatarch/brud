/**
 * Presents the unified engine through the existing `IUniversalHistoryService`
 * contract (`brud.core.universalHistory`), shaped exactly like the legacy
 * session ledger, so the daemon wire contract and plugins see no change.
 */
import type {
  CommitOutcome,
  IUniversalHistoryService,
} from '../../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import type {
  CommitReceipt,
  FileReversalAction,
  LedgerQueryFilter,
  PlanReversalOptions,
  ReversalConflict,
  ReversalPlan,
  ReversalReceipt,
  SessionManifest,
  SessionRow as LegacySessionRow,
  TargetDigest,
} from '../../contracts/IUniversalHistoryService/types.js';
import type { ReversalEngine, UnifiedReversalPlan } from '../engine/ReversalEngine.js';
import type { SessionTargetPayload } from '../service/builtinTypes.js';
import type { NamespaceHistoryHandle, SessionMetadata, TargetBaseline } from '../service/types.js';
import type { NamespaceHandleOptions, UnifiedHistoryService } from '../service/UnifiedHistoryService.js';

/**
 * Adapters built by the unified engine, mapped to their service. Kept off the
 * adapter's surface so `IUniversalHistoryService` (and the daemon contract)
 * gain nothing; the plugin manager reaches it through `namespaceHistoryFor`.
 */
const UNIFIED_SERVICES = new WeakMap<object, UnifiedHistoryService>();

/**
 * Returns a namespace-bound handle when `history` is backed by the unified
 * engine, or `undefined` on the legacy engine (rollback switch until U-7).
 */
export function namespaceHistoryFor(
  history: IUniversalHistoryService,
  namespace: string,
  options: NamespaceHandleOptions = {},
): NamespaceHistoryHandle | undefined {
  return UNIFIED_SERVICES.get(history)?.forNamespace(namespace, options);
}

/** Plans handed out by this adapter, mapped to the full native plan. */
const NATIVE_PLANS = new WeakMap<object, UnifiedReversalPlan>();

/** A legacy-shaped plan that this adapter did not produce. */
export class ForeignReversalPlanError extends Error {
  public readonly code = 'REVERSAL_PLAN_UNKNOWN' as const;

  constructor() {
    super('The reversal plan was not produced by this history service; plan again before executing');
    this.name = 'ForeignReversalPlanError';
  }
}

const iso = (epochMs: number): string => new Date(epochMs).toISOString();

function digest(path: string, state: TargetBaseline): TargetDigest {
  return {
    relativePath: path,
    sha256: state.sha256 ?? '',
    sizeBytes: state.size,
    isBinary: state.isBinary,
    exists: state.exists,
  };
}

export class LegacySessionAdapter implements IUniversalHistoryService {
  constructor(
    private readonly service: UnifiedHistoryService,
    private readonly engine: ReversalEngine,
  ) {
    UNIFIED_SERVICES.set(this, service);
  }

  beginSession(prompt: string, declaredTargets?: readonly string[]): Promise<string> {
    return this.service.beginSession(prompt, declaredTargets === undefined ? {} : { declaredTargets });
  }

  async commitSession(sessionId: string, outcome: CommitOutcome): Promise<CommitReceipt> {
    const receipt = await this.service.commitSession(sessionId, outcome);
    return {
      sessionId: receipt.sessionId,
      committedFileCount: receipt.committedFileCount,
      committedAt: new Date().toISOString(),
      blobs: receipt.blobs,
    };
  }

  async planReversal(sessionId: string, options?: PlanReversalOptions): Promise<ReversalPlan> {
    const native = await this.engine.planSessionReversal(sessionId, options?.targetState ?? 'pre');
    const actions: FileReversalAction[] = native.fileActions.map((action) => ({
      relativePath: action.path,
      action: action.action,
      targetBytes: action.targetBytes,
      expectedCurrentSha256: action.expectedCurrentSha256 ?? '',
      actualCurrentSha256: action.actualCurrentSha256,
    }));
    const conflicts: ReversalConflict[] = native.conflicts.map((conflict) => ({
      relativePath: conflict.path ?? `#${String(conflict.seq)}`,
      code: conflict.code as ReversalConflict['code'],
      message: conflict.message,
      expectedSha256: conflict.expectedSha256 ?? '',
      actualSha256: conflict.actualSha256 ?? null,
    }));
    const plan: ReversalPlan = Object.freeze({
      sessionId: native.sessionId,
      targetState: native.targetState,
      actions,
      conflicts,
      isExecutable: native.isExecutable,
    });
    NATIVE_PLANS.set(plan, native);
    return plan;
  }

  async executeReversal(plan: ReversalPlan): Promise<ReversalReceipt> {
    const native = NATIVE_PLANS.get(plan);
    if (native === undefined) {
      throw new ForeignReversalPlanError();
    }
    const receipt = await this.engine.executeSessionReversal(native);
    return {
      reversalId: receipt.reversalId,
      sessionId: receipt.sessionId,
      targetState: receipt.targetState,
      executedAt: iso(receipt.executedAt),
      filesRestored: receipt.filesRestored,
      filesDeleted: receipt.filesDeleted,
    };
  }

  async getSession(sessionId: string): Promise<SessionManifest | null> {
    const view = this.service.getSessionView(sessionId);
    if (view === undefined || view.session.implicit) {
      return null;
    }
    const preDigests: Record<string, TargetDigest> = {};
    const postDigests: Record<string, TargetDigest> = {};
    const changed = new Map<string, SessionTargetPayload>();
    for (const target of view.targets) {
      const payload = target.payload as SessionTargetPayload;
      changed.set(payload.path, payload);
    }
    for (const path of view.declaredTargets) {
      const before = view.baseline[path];
      if (before === undefined) {
        // Imported legacy sessions record no baseline for unchanged targets.
        continue;
      }
      preDigests[path] = digest(path, before);
      if (view.session.status === 'active') {
        continue;
      }
      const delta = changed.get(path);
      postDigests[path] = delta === undefined
        ? digest(path, before)
        : digest(path, {
          exists: delta.postSha256 !== null,
          sha256: delta.postSha256,
          size: delta.postSize,
          isBinary: delta.isBinary,
        });
    }
    return {
      schemaVersion: 1,
      sessionId: view.session.sessionId,
      createdAt: iso(view.session.createdAt),
      prompt: view.session.prompt,
      status: view.session.status,
      filesAffected: [...view.declaredTargets],
      preDigests,
      postDigests,
      revertRecordIds: this.service.store.listReversals(sessionId).map((row) => row.reversalId),
    };
  }

  async listSessions(filter?: LedgerQueryFilter): Promise<readonly LegacySessionRow[]> {
    const since = filter?.since === undefined ? undefined : Date.parse(filter.since);
    const page = this.service.listSessions({
      ...(filter?.status === undefined ? {} : { status: filter.status }),
      ...(filter?.limit === undefined ? {} : { limit: filter.limit }),
      ...(filter?.offset === undefined ? {} : { offset: filter.offset }),
      ...(filter?.includeDeleted === undefined ? {} : { includeDeleted: filter.includeDeleted }),
      ...(since === undefined || Number.isNaN(since) ? {} : { since }),
    });
    return page.rows.map((row) => ({
      session_id: row.sessionId,
      created_at: iso(row.createdAt),
      prompt: row.prompt,
      status: row.status,
      files_affected: JSON.stringify((row.metadata as SessionMetadata | null)?.declaredTargets ?? []),
      is_deleted: 0,
      deleted_at: null,
      expires_at: null,
    }));
  }

  /** Lifecycle hooks used by the unified descriptor. */
  async initialize(): Promise<void> {
    await this.service.start();
  }

  async dispose(): Promise<void> {
    await this.service.dispose();
  }
}
