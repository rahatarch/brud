/**
 * Presents the unified engine through the existing `IUniversalHistory`
 * contract (`brud.core.history`): undo, redo, checkpoints, and the mutation
 * list, shaped exactly like the legacy journal.
 */
import type { IUniversalHistory } from '../../contracts/IUniversalHistory.js';
import type {
  Checkpoint,
  HistoryEntry,
  HistoryQueryFilter,
  RollbackReport,
} from '../../contracts/models.js';
import type { ReversalEngine } from '../engine/ReversalEngine.js';
import { blobRef } from '../store/cas.js';
import { CORE_NAMESPACE, FILE_ENTRY_TYPE } from '../service/builtinTypes.js';
import type { FileEntryPayload } from '../service/builtinTypes.js';
import type { UnifiedHistoryService } from '../service/UnifiedHistoryService.js';

const DEFAULT_LIMIT = 1_000;

export class LegacyJournalAdapter implements IUniversalHistory {
  constructor(
    private readonly service: UnifiedHistoryService,
    private readonly engine: ReversalEngine,
  ) {}

  /** Starts a new automatic recording session. A no-op when history is degraded. */
  async beginSession(sessionId: string, _metadata?: Record<string, unknown>): Promise<void> {
    if (this.service.isDegraded) {
      return;
    }
    await this.service.flush();
    this.service.openRecordingSession(sessionId);
  }

  recordCheckpoint(label: string, metadata?: Record<string, unknown>): Promise<string> {
    return this.engine.recordCheckpoint(label, metadata);
  }

  async rollbackToCheckpoint(checkpointId: string): Promise<RollbackReport> {
    return this.engine.rollbackToCheckpoint(checkpointId);
  }

  async undo(stepCount?: number): Promise<RollbackReport> {
    return this.engine.undo(stepCount);
  }

  async redo(stepCount?: number): Promise<RollbackReport> {
    return this.engine.redo(stepCount);
  }

  async getHistory(filter: HistoryQueryFilter = {}): Promise<HistoryEntry[]> {
    await this.service.flush();
    const limit = filter.limit ?? DEFAULT_LIMIT;
    const offset = filter.offset ?? 0;
    const results: HistoryEntry[] = [];
    let skipped = 0;
    let beforeSeq: number | undefined;

    for (;;) {
      const page = this.service.listEntries({
        namespace: CORE_NAMESPACE,
        type: FILE_ENTRY_TYPE.type,
        order: 'desc',
        limit: 1000,
        ...(filter.sessionId === undefined ? {} : { sessionId: filter.sessionId }),
        ...(filter.targetPath === undefined ? {} : { path: filter.targetPath }),
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
      });
      for (const row of page.rows) {
        const payload = await this.service.resolvePayload(row) as FileEntryPayload;
        if (filter.operationKind !== undefined && payload.operation !== filter.operationKind) {
          continue;
        }
        if ((filter.since !== undefined && row.createdAt < filter.since) || (filter.until !== undefined && row.createdAt > filter.until)) {
          continue;
        }
        if (skipped < offset) {
          skipped += 1;
          continue;
        }
        const content = payload.postSha256 === null ? undefined : this.service.store.hasContent(payload.postSha256);
        results.push({
          mutationId: row.entryId,
          timestamp: row.createdAt,
          sessionId: row.sessionId,
          targetPath: payload.path,
          operationKind: payload.operation,
          previousHash: payload.preSha256 ?? '',
          updatedHash: payload.postSha256 ?? '',
          blobRef: content === true && payload.size > 64 * 1024 ? blobRef(payload.postSha256 as string) : null,
          metadata: { preCaptured: payload.preCaptured, nodeKind: payload.nodeKind, size: payload.size },
        });
        if (results.length >= limit) {
          return results;
        }
      }
      if (page.nextSeq === undefined) {
        return results;
      }
      beforeSeq = page.nextSeq;
    }
  }

  async getCheckpoints(sessionId?: string): Promise<Checkpoint[]> {
    return this.service.store.listCheckpoints(sessionId).map((row) => ({
      checkpointId: row.checkpointId,
      label: row.label,
      timestamp: row.createdAt,
      sessionId: row.sessionId,
      ledgerOffset: row.seqOffset,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
  }
}
