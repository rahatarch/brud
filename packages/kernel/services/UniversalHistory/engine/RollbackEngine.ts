import type { IBrudFileSystem } from '../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import type {
  DetectedDrift,
  RollbackReport,
  RollbackStatus,
} from '../contracts/models.js';
import { sha256Hex } from '../storage/hash.js';
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

function statusFor(skipped: readonly string[]): RollbackStatus {
  return skipped.length > 0 ? 'partial' : 'success';
}

/**
 * Reversal orchestrator for journal-recorded mutations.
 *
 * Every operation is planned from the ledger, validated against the current
 * on-disk digests before anything is written, and then applied through the
 * workspace filesystem. Files whose digest no longer matches history abort the
 * rollback (`drift_aborted`) instead of being overwritten.
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

    const applied = await this.applyUndo(entries);
    const nextCursor = Math.max(
      0,
      Math.min(...entries.map((entry) => entry.seq)) - 1,
    );

    this.storage.setCursor(nextCursor);

    return this.report(applied);
  }

  /**
   * Re-applies mutations previously reverted by {@link undo}.
   *
   * @param stepCount - Number of mutations to re-apply.
   */
  async redo(stepCount?: number): Promise<RollbackReport> {
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

    const applied = await this.applyRedo(entries);

    this.storage.setCursor(
      Math.max(...entries.map((entry) => entry.seq)),
    );

    return this.report(applied);
  }

  /**
   * Reverts every mutation newer than a checkpoint.
   *
   * @param checkpointId - Checkpoint to restore.
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<RollbackReport> {
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

    const applied = await this.applyUndo(entries);

    this.storage.setCursor(Math.min(cursor, checkpoint.ledgerOffset));

    return this.report(applied);
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
    direction: 'undo' | 'redo',
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

  private async applyUndo(entries: readonly MutationRecord[]): Promise<AppliedReport> {
    const restored: string[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
      if (entry.operationKind === 'mkdir') {
        skipped.push(entry.targetPath);
        continue;
      }

      const actualHash = await this.currentHash(entry.targetPath);

      if (actualHash !== entry.updatedHash) {
        skipped.push(entry.targetPath);
        continue;
      }

      try {
        if (entry.operationKind === 'write' && entry.previousHash.length === 0) {
          await this.deleteIfPresent(entry.targetPath);
          restored.push(entry.targetPath);
          continue;
        }

        const content = await this.storage.getContent(entry.previousHash);

        if (content === null) {
          skipped.push(entry.targetPath);
          continue;
        }

        await this.fileSystem.writeAtomic(entry.targetPath, content);
        restored.push(entry.targetPath);
      } catch {
        skipped.push(entry.targetPath);
      }
    }

    return {
      restoredPaths: unique(restored),
      skippedPaths: unique(skipped),
    };
  }

  private async applyRedo(entries: readonly MutationRecord[]): Promise<AppliedReport> {
    const restored: string[] = [];
    const skipped: string[] = [];

    for (const entry of entries) {
      if (entry.operationKind === 'mkdir') {
        skipped.push(entry.targetPath);
        continue;
      }

      const actualHash = await this.currentHash(entry.targetPath);

      if (actualHash !== entry.previousHash) {
        skipped.push(entry.targetPath);
        continue;
      }

      try {
        if (entry.operationKind === 'unlink' || entry.updatedHash.length === 0) {
          await this.deleteIfPresent(entry.targetPath);
          restored.push(entry.targetPath);
          continue;
        }

        const content = await this.storage.getContent(entry.updatedHash);

        if (content === null) {
          skipped.push(entry.targetPath);
          continue;
        }

        await this.fileSystem.writeAtomic(entry.targetPath, content);
        restored.push(entry.targetPath);
      } catch {
        skipped.push(entry.targetPath);
      }
    }

    return {
      restoredPaths: unique(restored),
      skippedPaths: unique(skipped),
    };
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
      detectedDrift: [],
      status: 'success',
    };
  }

  private driftReport(drift: readonly DetectedDrift[]): RollbackReport {
    return {
      restoredPaths: [],
      skippedPaths: [],
      detectedDrift: [...drift],
      status: 'drift_aborted',
    };
  }

  private report(applied: AppliedReport): RollbackReport {
    return {
      restoredPaths: applied.restoredPaths,
      skippedPaths: applied.skippedPaths,
      detectedDrift: [],
      status: statusFor(applied.skippedPaths),
    };
  }
}
