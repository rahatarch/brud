/**
 * Unified reversal engine (D-15, U-4).
 *
 * - Linear undo / redo / checkpoint rollback over recorded `brud.core.file`
 *   entries, with the legacy RollbackEngine semantics: per-path drift check,
 *   all-or-nothing payload pre-flight (re-hashed), compensation on a failed
 *   write, cursor moved only on success, recording suspended while writing.
 * - Session revert planned from `brud.core.session-target` entries (pure) plus
 *   producer entries by reversal mode: kernel-applied actions first, handlers
 *   last, one at a time, each bounded by a timeout.
 */
import { randomUUID } from 'node:crypto';
import type { IBrudFileSystem } from '../../../BrudFileSystem/contracts/IBrudFileSystem/IBrudFileSystem.js';
import { sha256Hex } from '../store/cas.js';
import {
  UnifiedBlobIntegrityError,
  UnifiedBlobMissingError,
  UnifiedHistoryDegradedError,
  UnifiedSessionNotFoundError,
} from '../store/errors.js';
import type { EntryRow } from '../store/types.js';
import { CORE_NAMESPACE, FILE_ENTRY_TYPE, SESSION_TARGET_ENTRY_TYPE } from '../service/builtinTypes.js';
import type { FileEntryPayload, SessionTargetPayload } from '../service/builtinTypes.js';
import type { UnifiedHistoryService } from '../service/UnifiedHistoryService.js';
import type { EntryView } from '../service/types.js';
import {
  UnifiedCheckpointNotFoundError,
  UnifiedReversalConflictError,
  UnifiedSessionNotRevertibleError,
} from './errors.js';
import type { UnifiedReversalConflict } from './errors.js';

export type RollbackStatus = 'success' | 'partial' | 'drift_aborted' | 'payload_missing' | 'payload_corrupt';

export interface UnifiedRollbackReport {
  readonly status: RollbackStatus;
  readonly restoredPaths: string[];
  readonly skippedPaths: string[];
  readonly corruptedPaths: string[];
  readonly detectedDrift: { readonly path: string; readonly expectedHash: string; readonly actualHash: string }[];
}

export interface FileReversalStep {
  readonly path: string;
  readonly action: 'restore' | 'delete';
  readonly targetBytes: Uint8Array | null;
  readonly expectedCurrentSha256: string | null;
  readonly actualCurrentSha256: string | null;
}

export interface EntryReversalStep {
  readonly seq: number;
  readonly namespace: string;
  readonly type: string;
  readonly schemaVersion: number;
  readonly mode: 'inverse-payload' | 'handler';
}

export interface UnifiedReversalPlan {
  readonly sessionId: string;
  readonly targetState: 'pre' | 'post';
  readonly fileActions: readonly FileReversalStep[];
  readonly entryActions: readonly EntryReversalStep[];
  readonly conflicts: readonly UnifiedReversalConflict[];
  readonly isExecutable: boolean;
}

export interface UnifiedReversalReceipt {
  readonly reversalId: string;
  readonly sessionId: string;
  readonly targetState: 'pre' | 'post';
  readonly executedAt: number;
  readonly status: 'success' | 'partial';
  readonly filesRestored: number;
  readonly filesDeleted: number;
  readonly entriesReverted: number;
  readonly failure?: { readonly seq: number; readonly message: string };
}

export interface ReversalEngineOptions {
  readonly service: UnifiedHistoryService;
  readonly fileSystem: () => IBrudFileSystem;
  /** Upper bound for each producer callback (inverse-payload apply or handler). */
  readonly callbackTimeoutMs?: number;
  readonly now?: () => number;
}

type Direction = 'undo' | 'redo';

interface FileStep {
  readonly entry: EntryRow;
  readonly payload: FileEntryPayload;
}

const DEFAULT_CALLBACK_TIMEOUT_MS = 10_000;

/** '' stands for "no file" in reports, as in the legacy engine. */
const hashText = (value: string | null): string => value ?? '';

async function settleJournal(): Promise<void> {
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
}

export class ReversalEngine {
  private readonly timeoutMs: number;

  private readonly now: () => number;

  constructor(private readonly options: ReversalEngineOptions) {
    this.timeoutMs = options.callbackTimeoutMs ?? DEFAULT_CALLBACK_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  private get service(): UnifiedHistoryService {
    return this.options.service;
  }

  private get fs(): IBrudFileSystem {
    return this.options.fileSystem();
  }

  // ── linear history ──────────────────────────────────────────────────

  async recordCheckpoint(label: string, metadata?: Record<string, unknown>): Promise<string> {
    this.assertWritable();
    await this.service.flush();
    const sessionId = this.service.implicitSession as string;
    const checkpointId = `CP-${randomUUID()}`;
    this.service.store.insertCheckpoint({
      checkpointId,
      sessionId,
      label,
      seqOffset: this.service.store.getCursor(),
      createdAt: this.now(),
      metadata: metadata ?? null,
    });
    return checkpointId;
  }

  async undo(steps?: number): Promise<UnifiedRollbackReport> {
    this.assertWritable();
    return this.runLinear(async () => {
      const entries = await this.fileSteps('desc', this.service.store.getCursor(), stepCount(steps));
      if (entries.length === 0) {
        return emptyReport();
      }
      const report = await this.applyBatch(entries, 'undo');
      if (report.status === 'success') {
        this.service.store.setCursor(Math.max(0, Math.min(...entries.map((e) => e.entry.seq)) - 1));
      }
      return report;
    });
  }

  async redo(steps?: number): Promise<UnifiedRollbackReport> {
    this.assertWritable();
    return this.runLinear(async () => {
      const entries = await this.fileSteps('asc', this.service.store.getCursor(), stepCount(steps));
      if (entries.length === 0) {
        return emptyReport();
      }
      const report = await this.applyBatch(entries, 'redo');
      if (report.status === 'success') {
        this.service.store.setCursor(Math.max(...entries.map((e) => e.entry.seq)));
      }
      return report;
    });
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<UnifiedRollbackReport> {
    this.assertWritable();
    const checkpoint = this.service.store.getCheckpoint(checkpointId);
    if (checkpoint === undefined) {
      throw new UnifiedCheckpointNotFoundError(checkpointId);
    }
    return this.runLinear(async () => {
      const cursor = this.service.store.getCursor();
      const entries = (await this.fileSteps('desc', cursor, Number.POSITIVE_INFINITY))
        .filter((step) => step.entry.seq > checkpoint.seqOffset);
      if (entries.length === 0) {
        this.service.store.setCursor(Math.min(cursor, checkpoint.seqOffset));
        return emptyReport();
      }
      const report = await this.applyBatch(entries, 'undo');
      if (report.status === 'success') {
        this.service.store.setCursor(Math.min(cursor, checkpoint.seqOffset));
      }
      return report;
    });
  }

  // ── session revert ──────────────────────────────────────────────────

  /** Pure, deterministic plan. Never writes. */
  async planSessionReversal(sessionId: string, targetState: 'pre' | 'post' = 'pre'): Promise<UnifiedReversalPlan> {
    const session = this.service.store.getSession(sessionId);
    if (session === undefined) {
      throw new UnifiedSessionNotFoundError(sessionId);
    }
    if (session.status !== 'committed') {
      throw new UnifiedSessionNotRevertibleError(sessionId, session.status);
    }

    const fileActions: FileReversalStep[] = [];
    const entryActions: EntryReversalStep[] = [];
    const conflicts: UnifiedReversalConflict[] = [];

    for (const entry of this.collect(sessionId)) {
      if (entry.namespace === CORE_NAMESPACE && entry.type === SESSION_TARGET_ENTRY_TYPE.type) {
        const target = await this.service.resolvePayload(entry) as SessionTargetPayload;
        const desired = targetState === 'pre' ? target.preSha256 : target.postSha256;
        const expected = targetState === 'pre' ? target.postSha256 : target.preSha256;
        const actual = await this.currentSha(target.path);
        let targetBytes: Uint8Array | null = null;

        if (actual !== expected) {
          conflicts.push({
            code: 'STALE_BASELINE_CONFLICT',
            path: target.path,
            expectedSha256: expected,
            actualSha256: actual,
            message: `"${target.path}" changed after the session; expected ${expected ?? 'no file'}, found ${actual ?? 'no file'}`,
          });
        }
        if (desired !== null) {
          try {
            targetBytes = await this.service.store.getContent(desired);
          } catch (error) {
            if (!(error instanceof UnifiedBlobMissingError) && !(error instanceof UnifiedBlobIntegrityError)) {
              throw error;
            }
            conflicts.push({
              code: 'BLOB_NOT_FOUND',
              path: target.path,
              expectedSha256: desired,
              actualSha256: null,
              message: `Cannot recover target bytes for "${target.path}" from stored content ${desired}: ${(error as Error).message}`,
            });
          }
        }
        fileActions.push({
          path: target.path,
          action: desired === null ? 'delete' : 'restore',
          targetBytes,
          expectedCurrentSha256: expected,
          actualCurrentSha256: actual,
        });
        continue;
      }

      if (entry.namespace === CORE_NAMESPACE) {
        continue;
      }

      const registered = this.service.store.getEntryType(entry.namespace, entry.type, entry.schemaVersion);
      const mode = registered?.reversalMode ?? 'none';
      if (mode === 'none') {
        continue;
      }
      const live = this.service.reversalFor(entry.namespace, entry.type, entry.schemaVersion);
      const step: EntryReversalStep = { seq: entry.seq, namespace: entry.namespace, type: entry.type, schemaVersion: entry.schemaVersion, mode };
      entryActions.push(step);

      if (live === undefined || live.mode !== mode) {
        conflicts.push({ code: 'REVERTER_UNAVAILABLE', seq: entry.seq, message: `${entry.namespace}.${entry.type} has no active reverter` });
        continue;
      }
      if (live.mode === 'inverse-payload') {
        const input = targetState === 'pre' ? entry.inversePayloadJson : entry.payloadJson;
        if (input === null) {
          conflicts.push({ code: 'INVERSE_PAYLOAD_INVALID', seq: entry.seq, message: `${entry.namespace}.${entry.type} entry ${entry.seq} has no inverse payload` });
          continue;
        }
        try {
          this.service.validatePayload(entry.namespace, entry.type, entry.schemaVersion, JSON.parse(input));
        } catch (error) {
          conflicts.push({ code: 'INVERSE_PAYLOAD_INVALID', seq: entry.seq, message: (error as Error).message });
        }
        continue;
      }
      if (targetState === 'post') {
        conflicts.push({ code: 'REVERTER_UNAVAILABLE', seq: entry.seq, message: 'handler entries cannot be re-applied forward' });
        continue;
      }
      try {
        const view = await this.entryView(entry);
        const conflict = await this.withTimeout(() => live.detectConflict(view));
        if (conflict !== null) {
          conflicts.push({ code: 'HANDLER_CONFLICT', seq: entry.seq, message: conflict.message });
        }
      } catch (error) {
        conflicts.push({ code: 'HANDLER_CONFLICT', seq: entry.seq, message: (error as Error).message });
      }
    }

    return Object.freeze({
      sessionId,
      targetState,
      fileActions: Object.freeze(fileActions),
      entryActions: Object.freeze(entryActions),
      conflicts: Object.freeze(conflicts),
      isExecutable: conflicts.length === 0,
    });
  }

  /**
   * Executes a plan. Re-checks every precondition first and writes nothing if
   * any changed. File actions run with compensation; producer callbacks run
   * after them, handlers last, each with a timeout. A callback failure yields
   * `partial` (files already restored are reported, not rolled forward).
   */
  async executeSessionReversal(plan: UnifiedReversalPlan): Promise<UnifiedReversalReceipt> {
    this.assertWritable();
    if (!plan.isExecutable || plan.conflicts.length > 0) {
      throw new UnifiedReversalConflictError(plan.sessionId, plan.conflicts);
    }
    const session = this.service.store.getSession(plan.sessionId);
    if (session === undefined) {
      throw new UnifiedSessionNotFoundError(plan.sessionId);
    }
    if (session.status !== 'committed') {
      throw new UnifiedSessionNotRevertibleError(plan.sessionId, session.status);
    }

    const stale: UnifiedReversalConflict[] = [];
    for (const action of plan.fileActions) {
      if (action.action === 'restore' && action.targetBytes === null) {
        stale.push({ code: 'BLOB_NOT_FOUND', path: action.path, message: `Restore action for "${action.path}" has no target bytes` });
        continue;
      }
      const actual = await this.currentSha(action.path);
      if (actual !== action.expectedCurrentSha256) {
        stale.push({ code: 'STALE_BASELINE_CONFLICT', path: action.path, expectedSha256: action.expectedCurrentSha256, actualSha256: actual, message: `"${action.path}" changed since planning` });
      }
    }
    for (const action of plan.entryActions) {
      const live = this.service.reversalFor(action.namespace, action.type, action.schemaVersion);
      if (live === undefined || live.mode !== action.mode) {
        stale.push({ code: 'REVERTER_UNAVAILABLE', seq: action.seq, message: `${action.namespace}.${action.type} has no active reverter` });
      }
    }
    if (stale.length > 0) {
      throw new UnifiedReversalConflictError(plan.sessionId, stale);
    }

    await this.service.flush();
    const applied: { path: string; prior: Uint8Array | null }[] = [];
    let filesRestored = 0;
    let filesDeleted = 0;
    try {
      for (const action of plan.fileActions) {
        const prior = await this.readIfFile(action.path);
        if (action.action === 'delete') {
          if (prior !== null) {
            await this.fs.deleteFile(action.path);
          }
          filesDeleted += 1;
        } else {
          await this.fs.writeAtomic(action.path, action.targetBytes as Uint8Array);
          filesRestored += 1;
        }
        applied.push({ path: action.path, prior });
      }
    } catch (error) {
      await this.compensate(applied);
      throw error;
    }

    const reverted: number[] = [];
    let failure: { seq: number; message: string } | undefined;
    const ordered = [
      ...plan.entryActions.filter((a) => a.mode === 'inverse-payload'),
      ...plan.entryActions.filter((a) => a.mode === 'handler'),
    ];
    for (const action of ordered) {
      try {
        const entry = this.service.store.getEntry(action.seq) as EntryRow;
        const live = this.service.reversalFor(action.namespace, action.type, action.schemaVersion);
        if (live === undefined || live.mode === 'none') {
          throw new Error(`${action.namespace}.${action.type} reverter became unavailable`);
        }
        if (live.mode === 'inverse-payload') {
          const input = JSON.parse((plan.targetState === 'pre' ? entry.inversePayloadJson : entry.payloadJson) as string) as unknown;
          await this.withTimeout((signal) => live.apply(input, { signal }));
        } else {
          const view = await this.entryView(entry);
          await this.withTimeout((signal) => live.revert(view, { signal }));
        }
        reverted.push(action.seq);
      } catch (error) {
        failure = { seq: action.seq, message: error instanceof Error ? error.message : String(error) };
        break;
      }
    }

    const status = failure === undefined ? 'success' : 'partial';
    const reversalId = `RV-${randomUUID()}`;
    const executedAt = this.now();
    this.service.store.transaction(() => {
      this.service.store.insertReversal({
        reversalId,
        sessionId: plan.sessionId,
        kind: 'session',
        targetState: plan.targetState,
        executedAt,
        status,
        revertedEntries: reverted,
        errorMessage: failure?.message ?? null,
      });
      if (status === 'success' && plan.targetState === 'pre') {
        this.service.store.transitionSession(plan.sessionId, ['committed'], 'reverted', executedAt);
      }
    });

    return Object.freeze({
      reversalId,
      sessionId: plan.sessionId,
      targetState: plan.targetState,
      executedAt,
      status,
      filesRestored,
      filesDeleted,
      entriesReverted: reverted.length,
      ...(failure === undefined ? {} : { failure }),
    });
  }

  /** @internal Builds the read-only view handed to producer callbacks. */
  async entryView(entry: EntryRow): Promise<EntryView> {
    return Object.freeze({
      seq: entry.seq,
      entryId: entry.entryId,
      sessionId: entry.sessionId,
      namespace: entry.namespace,
      type: entry.type,
      schemaVersion: entry.schemaVersion,
      payload: await this.service.resolvePayload(entry),
      inversePayload: entry.inversePayloadJson === null ? null : JSON.parse(entry.inversePayloadJson) as unknown,
      createdAt: entry.createdAt,
    });
  }

  // ── internals ───────────────────────────────────────────────────────

  private assertWritable(): void {
    if (this.service.isDegraded) {
      throw new UnifiedHistoryDegradedError(this.service.store.degradedReason ?? 'READ_ONLY_STORAGE');
    }
  }

  private async runLinear(operation: () => Promise<UnifiedRollbackReport>): Promise<UnifiedRollbackReport> {
    await this.service.flush();
    this.service.suspendRecording();
    try {
      return await operation();
    } finally {
      await settleJournal();
      this.service.resumeRecording();
    }
  }

  /** Non-`mkdir` file entries from the cursor, newest first (`desc`) or oldest first (`asc`). */
  private async fileSteps(order: 'asc' | 'desc', cursor: number, limit: number): Promise<FileStep[]> {
    const steps: FileStep[] = [];
    let bound = order === 'desc' ? cursor + 1 : cursor;
    for (;;) {
      const page = this.service.store.listEntries({
        namespace: CORE_NAMESPACE,
        type: FILE_ENTRY_TYPE.type,
        order,
        limit: 1000,
        ...(order === 'desc' ? { beforeSeq: bound } : { afterSeq: bound }),
      });
      for (const entry of page.rows) {
        const payload = await this.service.resolvePayload(entry) as FileEntryPayload;
        if (payload.operation !== 'mkdir') {
          steps.push({ entry, payload });
          if (steps.length >= limit) {
            return steps;
          }
        }
      }
      if (page.nextSeq === undefined) {
        return steps;
      }
      bound = page.nextSeq;
    }
  }

  private async applyBatch(steps: readonly FileStep[], direction: Direction): Promise<UnifiedRollbackReport> {
    const expectedByPath = new Map<string, string>();
    for (const { payload } of steps) {
      if (!expectedByPath.has(payload.path)) {
        expectedByPath.set(payload.path, hashText(direction === 'undo' ? payload.postSha256 : payload.preSha256));
      }
    }
    const drift: UnifiedRollbackReport['detectedDrift'] = [];
    for (const [path, expectedHash] of expectedByPath) {
      const actualHash = hashText(await this.currentSha(path));
      if (actualHash !== expectedHash) {
        drift.push({ path, expectedHash, actualHash });
      }
    }
    if (drift.length > 0) {
      return { ...emptyReport(), status: 'drift_aborted', detectedDrift: drift };
    }

    const missing: string[] = [];
    const corrupted: string[] = [];
    const bytesByHash = new Map<string, Uint8Array>();
    for (const { payload } of steps) {
      const required = direction === 'undo' ? payload.preSha256 : payload.postSha256;
      if (required === null || bytesByHash.has(required)) {
        continue;
      }
      try {
        bytesByHash.set(required, await this.service.store.getContent(required));
      } catch (error) {
        if (error instanceof UnifiedBlobIntegrityError) {
          corrupted.push(payload.path);
        } else if (error instanceof UnifiedBlobMissingError) {
          missing.push(payload.path);
        } else {
          throw error;
        }
      }
    }
    if (corrupted.length > 0 || missing.length > 0) {
      return {
        ...emptyReport(),
        status: corrupted.length > 0 ? 'payload_corrupt' : 'payload_missing',
        skippedPaths: [...new Set(missing)],
        corruptedPaths: [...new Set(corrupted)],
      };
    }

    const applied: { path: string; prior: Uint8Array | null }[] = [];
    const restored: string[] = [];
    for (const { payload } of steps) {
      const expected = hashText(direction === 'undo' ? payload.postSha256 : payload.preSha256);
      const target = direction === 'undo' ? payload.preSha256 : payload.postSha256;
      try {
        if (hashText(await this.currentSha(payload.path)) !== expected) {
          throw new Error('drift during apply');
        }
        const prior = await this.readIfFile(payload.path);
        if (target === null) {
          if (prior !== null) {
            await this.fs.deleteFile(payload.path);
          }
        } else {
          await this.fs.writeAtomic(payload.path, bytesByHash.get(target) as Uint8Array);
        }
        applied.push({ path: payload.path, prior });
        restored.push(payload.path);
      } catch {
        await this.compensate(applied);
        return { ...emptyReport(), status: 'partial', skippedPaths: [payload.path] };
      }
    }
    return { ...emptyReport(), restoredPaths: [...new Set(restored)] };
  }

  private async compensate(applied: readonly { path: string; prior: Uint8Array | null }[]): Promise<void> {
    for (const step of [...applied].reverse()) {
      try {
        if (step.prior === null) {
          if (await this.fs.exists(step.path)) {
            await this.fs.deleteFile(step.path);
          }
        } else {
          await this.fs.writeAtomic(step.path, step.prior);
        }
      } catch {
        // Best effort, as in the legacy engine.
      }
    }
  }

  private async readIfFile(path: string): Promise<Uint8Array | null> {
    if (!(await this.fs.exists(path))) {
      return null;
    }
    const stats = await this.fs.stat(path);
    if (stats === null || stats.isDirectory) {
      return null;
    }
    return this.fs.readFile(path);
  }

  private async currentSha(path: string): Promise<string | null> {
    try {
      const bytes = await this.readIfFile(path);
      return bytes === null ? null : sha256Hex(bytes);
    } catch {
      return null;
    }
  }

  private collect(sessionId: string): EntryRow[] {
    const rows: EntryRow[] = [];
    let page = this.service.store.listEntries({ sessionId, order: 'asc', limit: 1000 });
    for (;;) {
      rows.push(...page.rows);
      if (page.nextSeq === undefined) {
        return rows;
      }
      page = this.service.store.listEntries({ sessionId, order: 'asc', limit: 1000, afterSeq: page.nextSeq });
    }
  }

  private async withTimeout<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`reverter timed out after ${this.timeoutMs} ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([work(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
}

function stepCount(steps: number | undefined): number {
  return steps === undefined || !Number.isFinite(steps) || steps < 1 ? 1 : Math.floor(steps);
}

function emptyReport(): UnifiedRollbackReport {
  return { status: 'success', restoredPaths: [], skippedPaths: [], corruptedPaths: [], detectedDrift: [] };
}
