import { Buffer } from 'node:buffer';
import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  CommitOutcome,
  IUniversalHistoryService,
} from '../contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import type {
  BaselineSnapshot,
  BaselineTarget,
  OperationKind,
  SessionManifest,
  TargetDigest,
} from '../contracts/IUniversalHistoryService/types.js';
import {
  attachExecution,
  createSessionExecutionState,
} from '../operations/attach_execution/attachExecution.js';
import type {
  ExecutionOperation,
  ExecutionResult,
  SessionExecutionState,
} from '../operations/attach_execution/types.js';
import { InactiveSessionError } from '../operations/attach_execution/types.js';
import { captureBaseline as captureBaselineOperation } from '../operations/capture_baseline/captureBaseline.js';
import {
  casBlobPath,
  commitSession as commitSessionOperation,
} from '../operations/commit_session/commitSession.js';
import type { CommitReceipt } from '../operations/commit_session/types.js';
import {
  DEFAULT_BINARY_SIZE_THRESHOLD,
  computeDelta,
} from '../operations/compute_delta/computeDelta.js';
import type { FileChangeKind, FileDelta } from '../operations/compute_delta/types.js';
import { executeReversal as executeReversalOperation } from '../operations/execute_reversal/executeReversal.js';
import type { ReversalReceipt } from '../operations/execute_reversal/types.js';
import { planReversal as planReversalOperation } from '../operations/plan_reversal/planReversal.js';
import type {
  PlanReversalOptions,
  ReversalPlan,
} from '../operations/plan_reversal/types.js';
import { IdAllocator } from '../storage/IdAllocator/IdAllocator.js';
import { LedgerIndex } from '../storage/LedgerIndex/LedgerIndex.js';
import {
  SessionNotFoundError,
  type SqliteLedger,
} from '../storage/SqliteLedger/SqliteLedger.js';
import type {
  LedgerQueryFilter,
  SessionRow,
  SessionWithFiles,
} from '../storage/SqliteLedger/types.js';
import type { IServiceLifecycle } from '../../../src/contracts/lifecycle.js';

/** Clock injection point used by every timestamp this service emits. */
export type HistoryClock = () => Date;

/** Construction options for {@link UniversalHistoryService}. */
export interface UniversalHistoryServiceOptions {
  /** Durable ledger connection owned by the service. */
  readonly ledger: SqliteLedger;
  /** Workspace-scoped filesystem, possibly a lazily resolved facade. */
  readonly fileSystem: IBrudFileSystem;
  /** Identifier allocator; defaults to one bound to `fileSystem`. */
  readonly idAllocator?: IdAllocator;
  /** Clock override for deterministic tests. */
  readonly now?: HistoryClock;
}

/**
 * Thrown when an active session cannot be finalized because its in-memory
 * baseline is unavailable (for example, after a process restart).
 */
export class SessionStateUnavailableError extends Error {
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(`Session ${sessionId} has no live execution state for this process`);
    this.name = 'SessionStateUnavailableError';
    this.sessionId = sessionId;
  }
}

function operationKindFor(changeKind: FileChangeKind): OperationKind | null {
  if (changeKind === 'created') {
    return 'create_file';
  }

  if (changeKind === 'deleted') {
    return 'delete_file';
  }

  if (changeKind === 'modified') {
    return 'modify_file';
  }

  return null;
}

function parseAffectedPaths(raw: string): readonly string[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const items: readonly unknown[] = parsed;
  const paths: string[] = [];

  for (const item of items) {
    if (typeof item === 'string') {
      paths.push(item);
    }
  }

  return paths;
}

function digestFromRow(
  relativePath: string,
  sha256: string,
  isBinary: boolean,
): TargetDigest {
  const exists = sha256.length > 0;

  return {
    relativePath,
    sha256,
    sizeBytes: 0,
    isBinary: exists && isBinary,
    exists,
  };
}

function baselineBytes(target: BaselineTarget): Uint8Array | null {
  if (target.content !== undefined) {
    return target.content;
  }

  if (target.text !== undefined) {
    return Uint8Array.from(Buffer.from(target.text, 'utf8'));
  }

  return null;
}

/**
 * Facade that assembles the history storage and operation units.
 *
 * The orchestrator owns the durable {@link SqliteLedger}, the monotonic
 * {@link IdAllocator}, and the in-memory {@link LedgerIndex}, and delegates
 * every mutation and reconstruction step to the dedicated operation units.
 */
export class UniversalHistoryService implements IUniversalHistoryService, IServiceLifecycle {
  private readonly ledger: SqliteLedger;

  private readonly fileSystem: IBrudFileSystem;

  private readonly idAllocator: IdAllocator;

  private readonly index: LedgerIndex;

  private readonly now: HistoryClock;

  private readonly sessions = new Map<string, SessionExecutionState>();

  constructor(options: UniversalHistoryServiceOptions) {
    this.ledger = options.ledger;
    this.fileSystem = options.fileSystem;
    this.idAllocator = options.idAllocator ?? new IdAllocator(options.fileSystem);
    this.index = new LedgerIndex();
    this.now = options.now ?? ((): Date => new Date());
  }

  async beginSession(
    prompt: string,
    declaredTargets: readonly string[] = [],
  ): Promise<string> {
    const sessionId = await this.idAllocator.next();
    const baseline = await captureBaselineOperation({
      fileSystem: this.fileSystem,
      sessionId,
      relativePaths: declaredTargets,
      capturedAt: this.now().toISOString(),
    });

    await this.persistBaselineBlobs(baseline);

    const createdAt = baseline.capturedAt;
    const filesAffected = Object.keys(baseline.targets);

    this.ledger.createSession({
      session_id: sessionId,
      created_at: createdAt,
      prompt,
      status: 'active',
      files_affected: JSON.stringify(filesAffected),
    });

    const state = createSessionExecutionState(baseline);
    this.sessions.set(sessionId, state);
    this.refreshIndex(sessionId);

    return sessionId;
  }

  async commitSession(sessionId: string, outcome: CommitOutcome): Promise<CommitReceipt> {
    const state = this.requireActiveState(sessionId);

    if (outcome === 'aborted') {
      this.ledger.markSessionAborted(sessionId);
      this.sessions.set(sessionId, { ...state, status: 'aborted' });
      this.refreshIndex(sessionId);

      return {
        sessionId,
        committedFileCount: 0,
        committedAt: this.now().toISOString(),
        blobs: [],
      };
    }

    const deltas = await this.computeDeltas(state);
    await this.persistBinaryBaselineBlobs(state, deltas);
    const changed = deltas.filter((delta) => delta.isChanged);
    const operations: readonly ExecutionOperation[] = changed.flatMap((delta) => {
      const kind = operationKindFor(delta.changeKind);

      if (kind === null) {
        return [];
      }

      return [{
        id: `${sessionId}:${delta.relativePath}`,
        kind,
        relativePath: delta.relativePath,
        recordedAt: this.now().toISOString(),
      }];
    });
    const results: readonly ExecutionResult[] = operations.map((operation) => ({
      operationId: operation.id,
      success: true,
    }));

    const attached = attachExecution({
      session: state,
      operations,
      results,
      deltas,
      attachedAt: this.now().toISOString(),
    });

    const committedAt = this.now().toISOString();
    const receipt = await commitSessionOperation({
      ledger: this.ledger,
      fileSystem: this.fileSystem,
      sessionId,
      deltas: Object.values(attached.deltas),
      committedAt,
    });

    this.sessions.set(sessionId, { ...attached, status: 'committed' });
    this.refreshIndex(sessionId);

    return receipt;
  }

  async planReversal(
    sessionId: string,
    options?: PlanReversalOptions,
  ): Promise<ReversalPlan> {
    return planReversalOperation({
      ledger: this.ledger,
      fileSystem: this.fileSystem,
      sessionId,
      ...(options === undefined ? {} : { options }),
    });
  }

  async executeReversal(plan: ReversalPlan): Promise<ReversalReceipt> {
    const receipt = await executeReversalOperation({
      ledger: this.ledger,
      fileSystem: this.fileSystem,
      plan,
    });

    const state = this.sessions.get(plan.sessionId);

    if (state !== undefined) {
      this.sessions.set(plan.sessionId, { ...state, status: 'reverted' });
    }

    this.refreshIndex(plan.sessionId);

    return receipt;
  }

  async getSession(sessionId: string): Promise<SessionManifest | null> {
    const indexed = this.index.get(sessionId);

    if (indexed !== undefined) {
      return indexed;
    }

    const stored = this.ledger.getSession(sessionId);
    const manifest = this.manifestFromStored(stored, this.sessions.get(sessionId));

    if (manifest !== null) {
      this.index.upsert(manifest);
    }

    return manifest;
  }

  async listSessions(filter?: LedgerQueryFilter): Promise<readonly SessionRow[]> {
    return this.ledger.listSessions(filter);
  }

  dispose(): void {
    this.ledger.close();
    this.sessions.clear();
    this.index.clear();
  }

  private requireActiveState(sessionId: string): SessionExecutionState {
    const state = this.sessions.get(sessionId);

    if (state !== undefined) {
      if (state.status !== 'active') {
        throw new InactiveSessionError(sessionId, state.status);
      }

      return state;
    }

    const stored = this.ledger.getSession(sessionId);

    if (stored === null) {
      throw new SessionNotFoundError(sessionId);
    }

    if (stored.session.status !== 'active') {
      throw new InactiveSessionError(sessionId, stored.session.status);
    }

    throw new SessionStateUnavailableError(sessionId);
  }

  private async computeDeltas(state: SessionExecutionState): Promise<readonly FileDelta[]> {
    const deltas: FileDelta[] = [];

    for (const [relativePath, target] of Object.entries(state.baseline.targets)) {
      deltas.push(await computeDelta({
        fileSystem: this.fileSystem,
        relativePath,
        baseline: target.digest,
        baselinePayload: target,
      }));
    }

    return deltas;
  }

  private async persistBaselineBlobs(baseline: BaselineSnapshot): Promise<void> {
    for (const target of Object.values(baseline.targets)) {
      if (!target.digest.exists) {
        continue;
      }

      const eligible = target.digest.isBinary
        || target.digest.sizeBytes >= DEFAULT_BINARY_SIZE_THRESHOLD;

      if (!eligible) {
        continue;
      }

      const bytes = baselineBytes(target);

      if (bytes === null) {
        continue;
      }

      const relativePath = casBlobPath(target.digest.sha256);

      if (!(await this.fileSystem.exists(relativePath))) {
        await this.fileSystem.writeAtomic(relativePath, bytes);
      }
    }
  }

  /**
   * Ensures CAS carries the pre-mutation bytes of every delta that will be
   * persisted as a blob.
   *
   * A target can cross the binary size threshold between baseline capture and
   * commit; without its pre bytes a `pre` reversal could not be reconstructed.
   */
  private async persistBinaryBaselineBlobs(
    state: SessionExecutionState,
    deltas: readonly FileDelta[],
  ): Promise<void> {
    for (const delta of deltas) {
      if (!delta.isBinary || !delta.preDigest.exists) {
        continue;
      }

      const target = state.baseline.targets[delta.relativePath];

      if (target === undefined) {
        continue;
      }

      const bytes = baselineBytes(target);

      if (bytes === null) {
        continue;
      }

      const relativePath = casBlobPath(delta.preDigest.sha256);

      if (!(await this.fileSystem.exists(relativePath))) {
        await this.fileSystem.writeAtomic(relativePath, bytes);
      }
    }
  }

  private refreshIndex(sessionId: string): void {
    const stored = this.ledger.getSession(sessionId);
    const manifest = this.manifestFromStored(stored, this.sessions.get(sessionId));

    if (manifest !== null) {
      this.index.upsert(manifest);
    }
  }

  private manifestFromStored(
    stored: SessionWithFiles | null,
    state: SessionExecutionState | undefined,
  ): SessionManifest | null {
    if (stored === null) {
      return null;
    }

    const preDigests: Record<string, TargetDigest> = {};
    const postDigests: Record<string, TargetDigest> = {};

    for (const row of stored.files) {
      const isBinary = row.is_binary === 1;
      preDigests[row.relative_path] = digestFromRow(row.relative_path, row.pre_sha256, isBinary);
      postDigests[row.relative_path] = digestFromRow(row.relative_path, row.post_sha256, isBinary);
    }

    if (state !== undefined) {
      for (const [relativePath, target] of Object.entries(state.baseline.targets)) {
        preDigests[relativePath] = target.digest;

        if (postDigests[relativePath] === undefined) {
          postDigests[relativePath] = target.digest;
        }
      }

      for (const [relativePath, delta] of Object.entries(state.deltas)) {
        postDigests[relativePath] = delta.postDigest;
      }
    }

    const revertRecordIds = this.ledger
      .getReversalsForSession(stored.session.session_id)
      .map((reversal) => reversal.reversal_id);

    return {
      schemaVersion: 1,
      sessionId: stored.session.session_id,
      createdAt: stored.session.created_at,
      prompt: stored.session.prompt,
      status: stored.session.status,
      filesAffected: parseAffectedPaths(stored.session.files_affected),
      preDigests,
      postDigests,
      revertRecordIds,
      isDeleted: stored.session.is_deleted === 1,
      ...(stored.session.deleted_at === null ? {} : { deletedAt: stored.session.deleted_at }),
      ...(stored.session.expires_at === null ? {} : { expiresAt: stored.session.expires_at }),
    };
  }
}
