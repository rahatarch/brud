import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  DetectedDrift,
  RollbackReport,
  RollbackStatus,
} from '../contracts/models.js';
import { sha256Hex } from '../storage/hash.js';
import { BlobIntegrityError } from '../storage/SqliteHistoryStorage.js';
import type {
  MutationRecord,
  SqliteHistoryStorage,
} from '../storage/SqliteHistoryStorage.js';

/** Thrown when a rollback targets an unknown checkpoint. */
export class CheckpointNotFoundError extends Error {
  readonly checkpointId: string;

  constructor(checkpointId: string) {
    super(`History checkpoint not found: ${checkpointId}`);
    this.name = 'CheckpointNotFoundError';
    this.checkpointId = checkpointId;
  }
}

/** Construction options for {@link RollbackEngine}. */
export interface RollbackEngineOptions {
  /** Durable ledger owned by the history service. */
  readonly storage: SqliteHistoryStorage;

  /** Workspace filesystem used to inspect and restore targets. */
  readonly fileSystem: IBrudFileSystem;
}

/** Direction a batch is replayed in. */
type BatchDirection = 'undo' | 'redo';

/** One filesystem mutation planned from the ledger. */
interface PlannedStep {
  readonly path: string;

  /** Digest the target must have immediately before this step runs. */
  readonly expectedHash: string;

  readonly action: 'write' | 'delete';

  readonly payload: Uint8Array | null;
}

/** Payload resolution problems discovered before any write happens. */
interface PayloadScan {
  readonly missingPaths: string[];
  readonly corruptedPaths: string[];
}

/** Plan for a whole batch; empty payload problems mean it can be applied. */
interface BatchPlan extends PayloadScan {
  readonly steps: PlannedStep[];
}

/** State a target had before a step ran, used for mid-batch compensation. */
type PriorState =
  | { readonly present: false }
  | { readonly present: true; readonly bytes: Uint8Array };

interface AppliedStep {
  readonly path: string;
  readonly prior: PriorState;
}

interface AppliedReport {
  readonly restoredPaths: string[];
  readonly skippedPaths: string[];
}

function normalizeStepCount(stepCount: number | undefined): number {
  if (stepCount === undefined) {
    return 1;
  }

  if (!Number.isFinite(stepCount) || stepCount < 1) {
    return 1;
  }

  return Math.floor(stepCount);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Reversal orchestrator for journal-recorded mutations.
 *
 * Every operation is planned from the ledger, validated in two stages before
 * anything is written, and then applied through the workspace filesystem:
 *
 * 1. Drift scan: the newest recorded digest per target must still match disk.
 * 2. Payload scan: every pre-image in the whole batch must resolve and match
 *    its SHA-256 content address.
 *
 * A batch that fails either stage writes nothing at all. If an unexpected I/O
 * fault appears once writes have started, already-applied steps are
 * compensated and the cursor is frozen, so no file leaves historical reach.
 */
export class RollbackEngine {
  private readonly storage: SqliteHistoryStorage;

  private readonly fileSystem: IBrudFileSystem;

  constructor(options: RollbackEngineOptions) {
    this.storage = options.storage;
    this.fileSystem = options.fileSystem;
  }

  /**
   * Reverts the newest reversible mutations.
   *
   * @param stepCount - Number of mutations to revert.
   */
  async undo(stepCount?: number): Promise<RollbackReport> {
    this.storage.assertWritable();

    const cursor = this.storage.getCursor();
    const entries = this.storage.getMutationsDescending(
      cursor,
      normalizeStepCount(stepCount),
    );

    if (entries.length === 0) {
      return this.emptyReport();
    }

    const drift = await this.detectDrift(entries, 'undo');

    if (drift.length > 0) {
      return this.driftReport(drift);
    }

    const blocked = await this.preflight(entries, 'undo');

    if (blocked !== null) {
      return blocked;
    }

    const report = await this.applyPlanned(entries, 'undo');

    if (report.status === 'success') {
      this.storage.setCursor(
        Math.max(0, Math.min(...entries.map((entry) => entry.seq)) - 1),
      );
    }

    return report;
  }

  /**
   * Re-applies mutations previously reverted by {@link undo}.
   *
   * @param stepCount - Number of mutations to re-apply.
   */
  async redo(stepCount?: number): Promise<RollbackReport> {
    this.storage.assertWritable();

    const cursor = this.storage.getCursor();
    const entries = this.storage.getMutationsAscending(
      cursor,
      normalizeStepCount(stepCount),
    );

    if (entries.length === 0) {
      return this.emptyReport();
    }

    const drift = await this.detectDrift(entries, 'redo');

    if (drift.length > 0) {
      return this.driftReport(drift);
    }

    const blocked = await this.preflight(entries, 'redo');

    if (blocked !== null) {
      return blocked;
    }

    const report = await this.applyPlanned(entries, 'redo');

    if (report.status === 'success') {
      this.storage.setCursor(Math.max(...entries.map((entry) => entry.seq)));
    }

    return report;
  }

  /**
   * Reverts every mutation newer than a checkpoint.
   *
   * @param checkpointId - Checkpoint to restore.
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<RollbackReport> {
    this.storage.assertWritable();

    const checkpoint = this.storage.getCheckpoint(checkpointId);

    if (checkpoint === undefined) {
      throw new CheckpointNotFoundError(checkpointId);
    }

    const cursor = this.storage.getCursor();
    const entries = this.storage
      .getMutationsDescending(cursor, Number.POSITIVE_INFINITY)
      .filter((entry) => entry.seq > checkpoint.ledgerOffset);

    if (entries.length === 0) {
      this.storage.setCursor(Math.min(cursor, checkpoint.ledgerOffset));

      return this.emptyReport();
    }

    const drift = await this.detectDrift(entries, 'undo');

    if (drift.length > 0) {
      return this.driftReport(drift);
    }

    const blocked = await this.preflight(entries, 'undo');

    if (blocked !== null) {
      return blocked;
    }

    const report = await this.applyPlanned(entries, 'undo');

    if (report.status === 'success') {
      this.storage.setCursor(Math.min(cursor, checkpoint.ledgerOffset));
    }

    return report;
  }

  /**
   * Resolves and verifies every payload the batch will need.
   *
   * Nothing has been written when this runs, so a missing or corrupted
   * pre-image aborts the whole batch with a dedicated status.
   *
   * @returns A blocking report, or `null` when the batch may proceed.
   */
  private async preflight(
    entries: readonly MutationRecord[],
    direction: BatchDirection,
  ): Promise<RollbackReport | null> {
    const scan = await this.scanPayloads(entries, direction);

    if (scan.corruptedPaths.length > 0) {
      return this.payloadReport('payload_corrupt', scan);
    }

    if (scan.missingPaths.length > 0) {
      return this.payloadReport('payload_missing', scan);
    }

    return null;
  }

  private async scanPayloads(
    entries: readonly MutationRecord[],
    direction: BatchDirection,
  ): Promise<PayloadScan> {
    const missingPaths: string[] = [];
    const corruptedPaths: string[] = [];
    const verified = new Map<string, 'available' | 'missing' | 'corrupt'>();

    for (const entry of entries) {
      const requiredHash = this.requiredPayloadHash(entry, direction);

      if (requiredHash === null) {
        continue;
      }

      let status = verified.get(requiredHash);

      if (status === undefined) {
        status = await this.verifyPayload(requiredHash);
        verified.set(requiredHash, status);
      }

      if (status === 'missing') {
        missingPaths.push(entry.targetPath);
      } else if (status === 'corrupt') {
        corruptedPaths.push(entry.targetPath);
      }
    }

    return {
      missingPaths: unique(missingPaths),
      corruptedPaths: unique(corruptedPaths),
    };
  }

  private async verifyPayload(
    requiredHash: string,
  ): Promise<'available' | 'missing' | 'corrupt'> {
    let payload: Uint8Array | null;

    try {
      payload = await this.storage.getContent(requiredHash);
    } catch (error) {
      if (error instanceof BlobIntegrityError) {
        return 'corrupt';
      }

      throw error;
    }

    if (payload === null) {
      return 'missing';
    }

    // Inline payloads are verified here too, so a corrupted row can never be
    // replayed just because it never touched a blob file.
    return sha256Hex(payload) === requiredHash ? 'available' : 'corrupt';
  }

  private requiredPayloadHash(
    entry: MutationRecord,
    direction: BatchDirection,
  ): string | null {
    if (entry.operationKind === 'mkdir') {
      return null;
    }

    const hash = direction === 'undo' ? entry.previousHash : entry.updatedHash;

    return hash.length === 0 ? null : hash;
  }

  /**
   * Builds the exact step list for a batch.
   *
   * Payloads are re-resolved here; a pre-image that disappeared between the
   * pre-flight scan and planning still aborts the batch before any write.
   */
  private async planBatch(
    entries: readonly MutationRecord[],
    direction: BatchDirection,
  ): Promise<BatchPlan> {
    const steps: PlannedStep[] = [];
    const missingPaths: string[] = [];
    const corruptedPaths: string[] = [];

    for (const entry of entries) {
      if (entry.operationKind === 'mkdir') {
        continue;
      }

      const expectedHash = direction === 'undo'
        ? entry.updatedHash
        : entry.previousHash;
      const targetHash = direction === 'undo'
        ? entry.previousHash
        : entry.updatedHash;

      if (targetHash.length === 0) {
        steps.push({
          path: entry.targetPath,
          expectedHash,
          action: 'delete',
          payload: null,
        });
        continue;
      }

      let payload: Uint8Array | null;

      try {
        payload = await this.storage.getContent(targetHash);
      } catch (error) {
        if (error instanceof BlobIntegrityError) {
          corruptedPaths.push(entry.targetPath);
          continue;
        }

        throw error;
      }

      if (payload === null) {
        missingPaths.push(entry.targetPath);
        continue;
      }

      if (sha256Hex(payload) !== targetHash) {
        corruptedPaths.push(entry.targetPath);
        continue;
      }

      steps.push({
        path: entry.targetPath,
        expectedHash,
        action: 'write',
        payload,
      });
    }

    return {
      steps,
      missingPaths: unique(missingPaths),
      corruptedPaths: unique(corruptedPaths),
    };
  }

  /**
   * Plans a batch, then applies it when every payload still resolves.
   *
   * Planning re-resolves payloads after the pre-flight scan, so a blob that
   * disappears in between still blocks the batch before the first write.
   */
  private async applyPlanned(
    entries: readonly MutationRecord[],
    direction: BatchDirection,
  ): Promise<RollbackReport> {
    const plan = await this.planBatch(entries, direction);

    if (plan.corruptedPaths.length > 0 || plan.missingPaths.length > 0) {
      return this.payloadReport(
        plan.corruptedPaths.length > 0 ? 'payload_corrupt' : 'payload_missing',
        plan,
      );
    }

    return this.report(await this.applySteps(plan.steps));
  }

  /**
   * Applies a planned batch, compensating any completed step if a later step
   * fails. Targets are re-checked against their expected digest immediately
   * before each write so a concurrent external edit aborts instead of being
   * overwritten.
   */
  private async applySteps(steps: readonly PlannedStep[]): Promise<AppliedReport> {
    const applied: AppliedStep[] = [];
    const restored: string[] = [];

    for (const step of steps) {
      const actualHash = await this.currentHash(step.path);

      if (actualHash !== step.expectedHash) {
        await this.compensate(applied);

        return { restoredPaths: [], skippedPaths: [step.path] };
      }

      let prior: PriorState;

      try {
        prior = await this.readPriorState(step.path);
      } catch {
        await this.compensate(applied);

        return { restoredPaths: [], skippedPaths: [step.path] };
      }

      try {
        if (step.action === 'delete') {
          await this.deleteIfPresent(step.path);
        } else if (step.payload !== null) {
          await this.fileSystem.writeAtomic(step.path, step.payload);
        }
      } catch {
        await this.compensate(applied);

        return { restoredPaths: [], skippedPaths: [step.path] };
      }

      applied.push({ path: step.path, prior });
      restored.push(step.path);
    }

    return { restoredPaths: unique(restored), skippedPaths: [] };
  }

  /** Restores every already-applied step, newest first. */
  private async compensate(applied: readonly AppliedStep[]): Promise<void> {
    for (const step of [...applied].reverse()) {
      try {
        if (step.prior.present) {
          await this.fileSystem.writeAtomic(step.path, step.prior.bytes);
        } else {
          await this.deleteIfPresent(step.path);
        }
      } catch {
        // Compensation is best effort. The cursor stays frozen, so the batch
        // remains inside historical reach for a subsequent recovery pass.
      }
    }
  }

  private async readPriorState(path: string): Promise<PriorState> {
    if (!(await this.fileSystem.exists(path))) {
      return { present: false };
    }

    const stats = await this.fileSystem.stat(path);

    if (stats === null || stats.isDirectory) {
      return { present: false };
    }

    return { present: true, bytes: await this.fileSystem.readFile(path) };
  }

  /**
   * Validates the current workspace state before a plan is applied.
   *
   * Only the newest mutation per path describes the state that must exist on
   * disk right now. Older entries in the same plan describe intermediate
   * states that are recreated by the plan itself.
   */
  private async detectDrift(
    entries: readonly MutationRecord[],
    direction: BatchDirection,
  ): Promise<DetectedDrift[]> {
    const expectedByPath = new Map<string, string>();

    if (direction === 'undo') {
      for (const entry of entries) {
        if (!expectedByPath.has(entry.targetPath)) {
          expectedByPath.set(entry.targetPath, entry.updatedHash);
        }
      }
    } else {
      for (const entry of entries) {
        if (!expectedByPath.has(entry.targetPath)) {
          expectedByPath.set(entry.targetPath, entry.previousHash);
        }
      }
    }

    const drift: DetectedDrift[] = [];

    for (const [path, expectedHash] of expectedByPath) {
      const actualHash = await this.currentHash(path);

      if (actualHash !== expectedHash) {
        drift.push({ path, expectedHash, actualHash });
      }
    }

    return drift;
  }

  private async deleteIfPresent(path: string): Promise<void> {
    if (await this.fileSystem.exists(path)) {
      await this.fileSystem.deleteFile(path);
    }
  }

  private async currentHash(path: string): Promise<string> {
    try {
      if (!(await this.fileSystem.exists(path))) {
        return '';
      }

      const stats = await this.fileSystem.stat(path);

      if (stats === null || stats.isDirectory) {
        return '';
      }

      const bytes = await this.fileSystem.readFile(path);

      return sha256Hex(bytes);
    } catch {
      return '';
    }
  }

  private emptyReport(): RollbackReport {
    return {
      restoredPaths: [],
      skippedPaths: [],
      corruptedPaths: [],
      detectedDrift: [],
      status: 'success',
    };
  }

  private driftReport(drift: readonly DetectedDrift[]): RollbackReport {
    return {
      restoredPaths: [],
      skippedPaths: [],
      corruptedPaths: [],
      detectedDrift: [...drift],
      status: 'drift_aborted',
    };
  }

  private payloadReport(
    status: Extract<RollbackStatus, 'payload_missing' | 'payload_corrupt'>,
    scan: PayloadScan,
  ): RollbackReport {
    return {
      restoredPaths: [],
      skippedPaths: [...scan.missingPaths],
      corruptedPaths: [...scan.corruptedPaths],
      detectedDrift: [],
      status,
    };
  }

  private report(applied: AppliedReport): RollbackReport {
    return {
      restoredPaths: applied.restoredPaths,
      skippedPaths: applied.skippedPaths,
      corruptedPaths: [],
      detectedDrift: [],
      status: applied.skippedPaths.length > 0 ? 'partial' : 'success',
    };
  }
}
