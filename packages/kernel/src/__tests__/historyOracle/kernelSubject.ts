/**
 * Oracle subject over a real `createStandardKernel()` on a temporary on-disk
 * workspace with production defaults (durable Node driver, on-disk history).
 * History is reached only through the public tokens:
 * - session history → `brud.core.universalHistory` (`IUniversalHistoryService`)
 * - mutation history → `brud.core.history` (`IUniversalHistory`)
 *
 * `engine` selects `createStandardKernel({ historyEngine })`. Only error
 * classification and disk-level fault injection are engine-aware.
 */
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createStandardKernel } from '../../bootstrap/index.js';
import type { ServiceContext } from '../../contracts/lifecycle.js';
import type { BrudKernel } from '../../engine/BrudKernel.js';
import { FileSystemToken } from '../../../services/BrudFileSystem/descriptor/tokens.js';
import type { IUniversalHistory } from '../../../services/UniversalHistory/contracts/IUniversalHistory.js';
import type { RollbackReport } from '../../../services/UniversalHistory/contracts/models.js';
import type { IUniversalHistoryService } from '../../../services/UniversalHistory/contracts/IUniversalHistoryService/IUniversalHistoryService.js';
import { HistoryToken, UniversalHistoryToken } from '../../../services/UniversalHistory/descriptor/tokens.js';
import { InactiveSessionError } from '../../../services/UniversalHistory/operations/attach_execution/types.js';
import { ReversalConflictError } from '../../../services/UniversalHistory/operations/execute_reversal/types.js';
import type { ReversalPlan } from '../../../services/UniversalHistory/operations/plan_reversal/types.js';
import { SessionNotRevertibleError } from '../../../services/UniversalHistory/operations/plan_reversal/types.js';
import { HistoryDegradedError } from '../../../services/UniversalHistory/storage/SqliteHistoryStorage.js';
import { SessionNotFoundError } from '../../../services/UniversalHistory/storage/SqliteLedger/SqliteLedger.js';
import {
  UnifiedReversalConflictError,
  UnifiedSessionNotRevertibleError,
} from '../../../services/UniversalHistory/unified/engine/errors.js';
import { UnifiedSessionStateError } from '../../../services/UniversalHistory/unified/service/errors.js';
import {
  UnifiedHistoryDegradedError,
  UnifiedSessionNotFoundError,
} from '../../../services/UniversalHistory/unified/store/errors.js';
import type {
  HistoryOracleSubject,
  HistoryOracleSubjectFactory,
  OracleErrorKind,
  OracleRollbackReport,
  OracleSessionStatus,
  OracleWarning,
} from './subject.js';

const HISTORY_DIR = join('.brud', 'history');
const DATABASE_SUFFIXES = ['.db', '.db-wal', '.db-shm'];

function normalizeReport(report: RollbackReport): OracleRollbackReport {
  return {
    status: report.status,
    restoredPaths: [...report.restoredPaths],
    skippedPaths: [...report.skippedPaths],
    corruptedPaths: [...report.corruptedPaths],
    detectedDrift: report.detectedDrift.map((drift) => ({ ...drift })),
  };
}

function digestOf(entry: { readonly sha256?: string | null } | undefined): string | null {
  const value = entry?.sha256;
  return typeof value === 'string' && value.length > 0 && !/^0{64}$/u.test(value) ? value : null;
}

async function listFilesRecursive(directory: string): Promise<string[]> {
  const found: string[] = [];
  let names: string[];

  try {
    names = await readdir(directory);
  } catch {
    return found;
  }

  for (const name of names) {
    const full = join(directory, name);
    const info = await stat(full);

    if (info.isDirectory()) {
      found.push(...(await listFilesRecursive(full)));
    } else {
      found.push(full);
    }
  }

  return found;
}

export function createKernelSubject(engine: 'legacy' | 'unified'): HistoryOracleSubjectFactory {
  return async (options) => {
    const workspaceRoot = options?.workspaceRoot
      ?? await mkdtemp(join(tmpdir(), `brud-history-oracle-${engine}-`));
    const ownsWorkspace = options?.workspaceRoot === undefined;
    const historyDir = join(workspaceRoot, HISTORY_DIR);

    if (options?.readOnlyHistoryDirectory === true) {
      await mkdir(historyDir, { recursive: true });
      await chmod(historyDir, 0o555);
    }

    const warnings: OracleWarning[] = [];
    const kernel: BrudKernel = createStandardKernel({
      historyEngine: engine,
      logger: {
        warn: (message, meta) => {
          warnings.push({
            message,
            ...(typeof meta?.code === 'string' ? { code: meta.code } : {}),
            ...(typeof meta?.reason === 'string' ? { reason: meta.reason } : {}),
          });
        },
      },
    });

    await kernel.boot({ workspaceRoot });

    const caller: ServiceContext = { callerId: 'history.oracle', tier: 'core', workspaceRoot };
    const fs = kernel.requestAccess(caller, FileSystemToken);
    const sessions: IUniversalHistoryService = kernel.requestAccess(caller, UniversalHistoryToken);
    const journal: IUniversalHistory = kernel.requestAccess(caller, HistoryToken);

    const blobCopies = async (sha256: string): Promise<string[]> => {
      const files = await listFilesRecursive(historyDir);
      return files.filter((path) => path.endsWith(sha256) && !DATABASE_SUFFIXES.some((suffix) => path.endsWith(suffix)));
    };

    /** Unified engine only: content at or under 64 KiB lives inline in `universal.db`. */
    const inlineRows = (sha256: string, mutate: 'delete' | 'corrupt'): number => {
      if (engine !== 'unified') {
        return 0;
      }
      const db = new DatabaseSync(join(historyDir, 'universal.db'));
      try {
        db.exec('PRAGMA busy_timeout = 5000');
        const result = mutate === 'delete'
          ? db.prepare('DELETE FROM contents WHERE sha256 = ? AND inline_data IS NOT NULL').run(sha256)
          : db.prepare("UPDATE contents SET inline_data = CAST('tampered by the history oracle' AS BLOB) WHERE sha256 = ? AND inline_data IS NOT NULL").run(sha256);
        return Number(result.changes);
      } finally {
        db.close();
      }
    };

    const subject: HistoryOracleSubject = {
      workspaceRoot,
      fs,
      warnings,

      beginSession: (prompt, declaredTargets) => sessions.beginSession(prompt, declaredTargets),

      commitSession: async (sessionId, outcome) => {
        const receipt = await sessions.commitSession(sessionId, outcome);
        return { committedFileCount: receipt.committedFileCount };
      },

      getSession: async (sessionId) => {
        const manifest = await sessions.getSession(sessionId);

        if (manifest === null) {
          return null;
        }

        const pre: Record<string, string | null> = {};
        const post: Record<string, string | null> = {};

        for (const path of manifest.filesAffected) {
          pre[path] = digestOf(manifest.preDigests[path]);
          post[path] = digestOf(manifest.postDigests[path]);
        }

        return {
          sessionId,
          status: manifest.status as OracleSessionStatus,
          filesAffected: [...manifest.filesAffected],
          preDigests: pre,
          postDigests: post,
          reversalCount: manifest.revertRecordIds?.length ?? 0,
        };
      },

      listSessions: async (filter) => {
        const rows = await sessions.listSessions({
          ...(filter?.status === undefined ? {} : { status: filter.status }),
          ...(filter?.limit === undefined ? {} : { limit: filter.limit }),
        } as never);

        return rows.map((row) => ({
          sessionId: row.session_id,
          status: row.status as OracleSessionStatus,
        }));
      },

      planReversal: async (sessionId, targetState) => {
        const plan = await sessions.planReversal(
          sessionId,
          targetState === undefined ? undefined : { targetState },
        );

        return {
          targetState: plan.targetState as 'pre' | 'post',
          isExecutable: plan.isExecutable,
          actions: plan.actions.map((action) => ({ path: action.relativePath, action: action.action })),
          conflicts: plan.conflicts.map((conflict) => ({ path: conflict.relativePath, code: conflict.code })),
          native: plan,
        };
      },

      executeReversal: async (plan) => {
        const receipt = await sessions.executeReversal(plan.native as ReversalPlan);
        return { filesRestored: receipt.filesRestored, filesDeleted: receipt.filesDeleted };
      },

      openRecordingSession: (name) => journal.beginSession(name),

      settle: async () => {
        await journal.getHistory({ limit: 1 });
      },

      listFileEntries: async (filter) => {
        const entries = await journal.getHistory({
          ...(filter?.path === undefined ? {} : { targetPath: filter.path }),
          ...(filter?.operation === undefined ? {} : { operationKind: filter.operation }),
          limit: 100_000,
        });

        return entries.map((entry) => ({
          path: entry.targetPath,
          operation: entry.operationKind,
          previousHash: entry.previousHash,
          updatedHash: entry.updatedHash,
        }));
      },

      recordCheckpoint: (label) => journal.recordCheckpoint(label),
      rollbackToCheckpoint: async (checkpointId) => normalizeReport(await journal.rollbackToCheckpoint(checkpointId)),
      undo: async (steps) => normalizeReport(await journal.undo(steps)),
      redo: async (steps) => normalizeReport(await journal.redo(steps)),

      writeExternally: async (relativePath, data) => {
        const target = join(workspaceRoot, relativePath);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);
      },

      removeStoredContent: async (sha256) => {
        const copies = await blobCopies(sha256);
        await Promise.all(copies.map((path) => rm(path, { force: true })));
        return copies.length + inlineRows(sha256, 'delete');
      },

      corruptStoredContent: async (sha256) => {
        const copies = await blobCopies(sha256);
        await Promise.all(copies.map((path) => writeFile(path, 'tampered by the history oracle')));
        return copies.length + inlineRows(sha256, 'corrupt');
      },

      historyDatabaseFiles: async () => {
        const files = await listFilesRecursive(historyDir);
        return files.filter((path) => path.endsWith('.db'));
      },

      classifyError: (error): OracleErrorKind => {
        if (error instanceof SessionNotFoundError || error instanceof UnifiedSessionNotFoundError) {
          return 'SESSION_NOT_FOUND';
        }
        if (error instanceof SessionNotRevertibleError || error instanceof UnifiedSessionNotRevertibleError) {
          return 'SESSION_NOT_REVERTIBLE';
        }
        if (error instanceof InactiveSessionError || error instanceof UnifiedSessionStateError) {
          return 'SESSION_INACTIVE';
        }
        if (error instanceof ReversalConflictError || error instanceof UnifiedReversalConflictError) {
          return 'PLAN_NOT_EXECUTABLE';
        }
        if (error instanceof HistoryDegradedError || error instanceof UnifiedHistoryDegradedError) {
          return 'HISTORY_DEGRADED';
        }
        if (error instanceof Error && 'rule' in error && error.rule === 'PROTECTED_PATH_DENIED') {
          return 'PROTECTED_PATH_DENIED';
        }
        return 'OTHER';
      },

      dispose: async () => {
        if (kernel.lifecycleState === 'RUNNING') {
          await kernel.shutdown();
        }

        if (options?.readOnlyHistoryDirectory === true) {
          await chmod(historyDir, 0o755).catch(() => undefined);
        }

        if (ownsWorkspace) {
          await rm(workspaceRoot, { recursive: true, force: true });
        }
      },
    };

    return subject;
  };
}
